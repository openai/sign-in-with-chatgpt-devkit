import AppKit
import ApplicationServices
import CoreGraphics
import Security

private let maximumTextLength = 60_000
private let builtinRecipes = [
    ("spreadsheet", "Spreadsheet"), ("message", "Message"),
    ("translate", "Translate"), ("checklist", "Checklist"), ("cleanup", "Clean up")
]
private let languages = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Hindi", "Tamil", "Japanese", "Korean", "Chinese"]

// This handle is created by the native app. Its own stdin/stdout are never IPC.
private var desktopInput: FileHandle?
private var closeDesktop: (() -> Void)?

private func emit(_ event: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(event),
          let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
    #if PASTE_PERFECT_NATIVE_TESTS
    let output = FileHandle.standardOutput
    #else
    guard let output = desktopInput else { return }
    #endif
    do { try output.write(contentsOf: data + Data([10])) }
    catch { /* Child termination closes the session and disarms the controller. */ }
}

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

private func axElement(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

private func selectedRange(_ element: AXUIElement) -> CFRange? {
    guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let rangeValue = unsafeBitCast(value, to: AXValue.self)
    guard AXValueGetType(rangeValue) == .cfRange else { return nil }
    var range = CFRange()
    return AXValueGetValue(rangeValue, .cfRange, &range) ? range : nil
}

private func sameRange(_ lhs: CFRange, _ rhs: CFRange) -> Bool {
    lhs.location == rhs.location && lhs.length == rhs.length
}

private func focusedElement(_ pid: pid_t) -> AXUIElement? {
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 0.3)
    guard let element = axElement(attribute(application, kAXFocusedUIElementAttribute)) else { return nil }
    AXUIElementSetMessagingTimeout(element, 0.3)
    return element
}

private func isEditable(_ element: AXUIElement) -> Bool {
    if (attribute(element, kAXSubroleAttribute) as? String) == kAXSecureTextFieldSubrole { return false }
    if let enabled = attribute(element, kAXEnabledAttribute) as? Bool, !enabled { return false }
    let role = attribute(element, kAXRoleAttribute) as? String ?? ""
    if [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role) { return true }
    if (attribute(element, "AXEditable") as? Bool) == true { return true }
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success && settable.boolValue
}

private func isWithin(_ child: AXUIElement, _ ancestor: AXUIElement) -> Bool {
    var current: AXUIElement? = child
    for _ in 0..<14 {
        guard let item = current else { return false }
        if CFEqual(item, ancestor) { return true }
        current = axElement(attribute(item, kAXParentAttribute))
    }
    return false
}

private struct Target {
    let pid: pid_t
    let name: String
    let focused: AXUIElement
    let range: CFRange?
    let clipboardChange: Int
    let text: String
}

private struct Pending {
    let id: String
    let target: Target
    var result: String?
}

private final class NativeController: NSObject, NSApplicationDelegate {
    private var shuttingDown = false
    private var connected = false
    private var recipes: [(String, String)] = []
    private var eventTap: CFMachPort?
    private var eventSource: CFRunLoopSource?
    private var armTimer: Timer?
    private var permissionTimer: Timer?
    private var lastPermission = false
    private var armed = false
    private var suppressMouseUp = false
    private var presentOnMouseUp = false
    private var listenerAvailable = true
    private var generation = 0
    private var clickPoint: CGPoint?
    private var clickPid: pid_t?
    private var menuTarget: Target?
    private var menu: NSMenu?
    private var afterMenuAction: (() -> Void)?
    private var pending: Pending?
    private var progress: NSPanel?
    private var pendingMessage: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        lastPermission = AXIsProcessTrusted()
        status()
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self else { return }
            let permission = AXIsProcessTrusted()
            if permission != self.lastPermission {
                self.lastPermission = permission
                self.listenerAvailable = true
                if !permission { self.generation += 1; self.disarm(); self.menu?.cancelTracking() }
                self.status()
            }
        }
    }

    func status(_ message: String? = nil) {
        var event: [String: Any] = ["type": "status", "available": listenerAvailable,
            "accessibilityGranted": AXIsProcessTrusted(), "armed": armed]
        if let message { event["message"] = message }
        emit(event)
    }

    func handle(_ command: [String: Any]) {
        guard let type = command["type"] as? String else { report("The native command was invalid."); return }
        switch type {
        case "configure":
            connected = command["connected"] as? Bool ?? false
            let incoming = command["recipes"] as? [[String: Any]] ?? []
            var seen = Set(builtinRecipes.map { $0.0 })
            recipes = Array(incoming.compactMap { item -> (String, String)? in
                guard let id = item["id"] as? String, let name = item["name"] as? String,
                      !id.isEmpty, id.utf16.count <= 100, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      name.utf16.count <= 64, !seen.contains(id) else { return nil }
                seen.insert(id)
                return (id, name)
            }.prefix(100))
            status()
        case "arm": arm(timeout: command["timeoutMs"] as? Double ?? 8_000)
        case "show-menu":
            generation += 1
            disarm()
            presentMenu(point: nil, expectedPid: NSWorkspace.shared.frontmostApplication?.processIdentifier)
        case "result":
            guard let id = command["id"] as? String, let text = command["text"] as? String,
                  let current = pending, current.id == id else { return }
            guard !text.isEmpty, text.utf16.count <= 1_000_000 else {
                fail(id: id, message: "The transformation did not return a usable result.")
                return
            }
            pending?.result = text
            hideProgress()
            if menu == nil && targetStillMatches(current.target, requireClipboard: true, requireRange: true) {
                paste(id: id, explicit: false)
            } else {
                resultReady("Your result is ready. Return to the original insertion point, press the shortcut, then right-click to paste or copy.")
            }
        case "failure":
            guard let id = command["id"] as? String, pending?.id == id else { return }
            fail(id: id, message: safeMessage(command["message"] as? String))
        case "cancel":
            if let id = command["id"] as? String, pending?.id != id { return }
            generation += 1
            afterMenuAction = nil
            cancelPending(emitEvent: true)
            disarm()
            menu?.cancelTracking()
        case "request-permission":
            generation += 1
            disarm()
            menu?.cancelTracking()
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
            status("Enable the app shown by macOS in Accessibility, then return to the destination app.")
        case "status": status()
        case "quit": shutdown()
        default: report("The native command is not supported.")
        }
    }

    private func arm(timeout: Double) {
        generation += 1
        disarm()
        guard !suppressMouseUp else { status("Release the right mouse button, then press the shortcut again."); return }
        guard AXIsProcessTrusted() else {
            status("Enable Accessibility in Paste Perfect's dashboard to use the native menu.")
            return
        }
        let mask = (CGEventMask(1) << CGEventType.rightMouseDown.rawValue) | (CGEventMask(1) << CGEventType.rightMouseUp.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, userInfo in
            guard let userInfo else { return Unmanaged.passUnretained(event) }
            return Unmanaged<NativeController>.fromOpaque(userInfo).takeUnretainedValue().mouseEvent(type, event)
        }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                         eventsOfInterest: mask, callback: callback,
                                         userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
            listenerAvailable = false
            status("macOS could not enable the right-click listener. Check Accessibility permission and restart Paste Perfect.")
            report("The native right-click listener could not start.")
            return
        }
        eventTap = tap
        listenerAvailable = true
        eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        if let eventSource { CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes) }
        armed = true
        CGEvent.tapEnable(tap: tap, enable: true)
        let seconds = min(max(timeout.isFinite ? timeout / 1000 : 8, 1), 8)
        armTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.generation += 1
            self?.disarm()
            self?.status("Paste Perfect stopped waiting for a right-click.")
        }
        status("Right-click in the focused destination field to open Paste Perfect.")
    }

    private func mouseEvent(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            DispatchQueue.main.async { [weak self] in
                self?.generation += 1
                self?.listenerAvailable = false
                self?.disarm(preservingMouseUp: false)
                self?.status("The right-click listener was interrupted. Press the shortcut again.")
            }
            return Unmanaged.passUnretained(event)
        }
        if type == .rightMouseDown && armed {
            // The tap performs no AX calls, clipboard reads, JSON writes, or menu tracking.
            armed = false
            suppressMouseUp = true
            presentOnMouseUp = true
            clickPoint = event.location
            clickPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
            armTimer?.invalidate()
            armTimer = nil
            return nil
        }
        if type == .rightMouseUp && suppressMouseUp {
            suppressMouseUp = false
            let point = clickPoint
            let pid = clickPid
            let shouldPresent = presentOnMouseUp
            let operation = generation
            let releasedTap = eventTap
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard operation == self.generation else {
                    if let releasedTap, let currentTap = self.eventTap, CFEqual(releasedTap, currentTap) { self.disarm() }
                    return
                }
                self.disarm()
                self.status()
                if shouldPresent { self.presentMenu(point: point, expectedPid: pid) }
            }
            return nil
        }
        return Unmanaged.passUnretained(event)
    }

    private func disarm(preservingMouseUp: Bool = true) {
        armed = false
        presentOnMouseUp = false
        armTimer?.invalidate()
        armTimer = nil
        // Once a down event was swallowed, consume its matching up even if cancelled.
        if preservingMouseUp && suppressMouseUp { return }
        suppressMouseUp = false
        if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: false) }
        if let eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), eventSource, .commonModes) }
        if let eventTap { CFMachPortInvalidate(eventTap) }
        eventSource = nil
        eventTap = nil
        clickPoint = nil
        clickPid = nil
    }

    private func captureTarget(point: CGPoint?, expectedPid: pid_t?) -> Target? {
        guard AXIsProcessTrusted(), let application = NSWorkspace.shared.frontmostApplication,
              application.processIdentifier == expectedPid, application.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              let focused = focusedElement(application.processIdentifier), isEditable(focused) else { return nil }
        if let point {
            let system = AXUIElementCreateSystemWide()
            AXUIElementSetMessagingTimeout(system, 0.3)
            var clicked: AXUIElement?
            guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &clicked) == .success,
                  let clicked, isWithin(clicked, focused) else { return nil }
        }
        let pasteboard = NSPasteboard.general
        let change = pasteboard.changeCount
        guard let text = pasteboard.string(forType: .string), pasteboard.changeCount == change,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= maximumTextLength else { return nil }
        return Target(pid: application.processIdentifier, name: application.localizedName ?? "the original app",
                      focused: focused, range: selectedRange(focused), clipboardChange: change, text: text)
    }

    private func presentMenu(point: CGPoint?, expectedPid: pid_t?) {
        guard menu == nil else { return }
        let operation = generation
        let nativeMenu = NSMenu(title: "Paste Perfect")
        nativeMenu.autoenablesItems = false
        nativeMenu.addItem(withTitle: "Paste Perfect", action: nil, keyEquivalent: "").isEnabled = false
        if let current = pending {
            nativeMenu.addItem(.separator())
            if current.result != nil {
                let pasteItem = addItem(nativeMenu, "Paste result into \(current.target.name)", #selector(pasteSelected))
                pasteItem.isEnabled = targetStillMatches(current.target, requireClipboard: false, requireRange: false)
                addItem(nativeMenu, "Copy result", #selector(copySelected))
                if let pendingMessage { nativeMenu.addItem(withTitle: pendingMessage, action: nil, keyEquivalent: "").isEnabled = false }
                addItem(nativeMenu, "Discard result", #selector(cancelSelected))
            } else {
                nativeMenu.addItem(withTitle: "Transforming with ChatGPT…", action: nil, keyEquivalent: "").isEnabled = false
                addItem(nativeMenu, "Cancel transformation", #selector(cancelSelected))
            }
        } else {
            menuTarget = captureTarget(point: point, expectedPid: expectedPid)
            let ready = connected && menuTarget != nil
            let original = addItem(nativeMenu, "Paste original", #selector(transformSelected))
            original.representedObject = ["recipeId": "original"]
            original.isEnabled = menuTarget != nil
            if !connected {
                nativeMenu.addItem(withTitle: "Connect ChatGPT in the dashboard", action: nil, keyEquivalent: "").isEnabled = false
            } else if menuTarget == nil {
                nativeMenu.addItem(withTitle: "Focus an editable field and copy readable text first", action: nil, keyEquivalent: "").isEnabled = false
            }
            nativeMenu.addItem(.separator())
            for (id, name) in builtinRecipes {
                if id == "translate" {
                    let item = NSMenuItem(title: name, action: nil, keyEquivalent: "")
                    let submenu = NSMenu(title: "Translate")
                    submenu.autoenablesItems = false
                    for language in languages {
                        let choice = addItem(submenu, language, #selector(transformSelected))
                        choice.representedObject = ["recipeId": id, "targetLanguage": language]
                        choice.isEnabled = ready
                    }
                    item.submenu = submenu
                    item.isEnabled = ready
                    nativeMenu.addItem(item)
                } else {
                    let item = addItem(nativeMenu, name, #selector(transformSelected))
                    item.representedObject = ["recipeId": id]
                    item.isEnabled = ready
                }
            }
            if !recipes.isEmpty { nativeMenu.addItem(.separator()) }
            for (id, name) in recipes {
                let item = addItem(nativeMenu, name, #selector(transformSelected))
                item.representedObject = ["recipeId": id]
                item.isEnabled = ready
            }
        }
        nativeMenu.addItem(.separator())
        addItem(nativeMenu, "Open dashboard…", #selector(openDashboard))
        menu = nativeMenu
        let screenPoint: NSPoint
        if let point, let primary = NSScreen.screens.first {
            // CGEvent/AX coordinates start at the primary display's top-left;
            // AppKit screen coordinates start at its bottom-left, including other displays.
            screenPoint = NSPoint(x: point.x, y: primary.frame.maxY - point.y)
        } else { screenPoint = NSEvent.mouseLocation }
        nativeMenu.popUp(positioning: nil, at: screenPoint, in: nil)
        menu = nil
        menuTarget = nil
        let action = afterMenuAction
        afterMenuAction = nil
        if operation == generation { action?() }
    }

    @discardableResult private func addItem(_ menu: NSMenu, _ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc private func transformSelected(_ item: NSMenuItem) {
        guard pending == nil, let target = menuTarget,
              let choice = item.representedObject as? [String: String], let recipeId = choice["recipeId"] else { return }
        guard connected || recipeId == "original" else { return }
        // NSMenu can run its own tracking loop; start after it has dismissed.
        afterMenuAction = { [weak self] in
            guard let self else { return }
            guard self.targetStillMatches(target, requireClipboard: true, requireRange: false) else {
                self.report("The destination or clipboard changed. Focus the destination and try again.")
                return
            }
            let id = UUID().uuidString
            self.pending = Pending(id: id, target: target, result: nil)
            self.pendingMessage = nil
            self.showProgress(recipeId == "original" ? "Pasting original text…" : "Transforming with ChatGPT…")
            var event: [String: Any] = ["type": "invoke", "id": id, "recipeId": recipeId, "text": target.text, "targetApp": target.name]
            if let language = choice["targetLanguage"] { event["targetLanguage"] = language }
            emit(event)
        }
    }

    private func targetStillMatches(_ target: Target, requireClipboard: Bool, requireRange: Bool) -> Bool {
        guard AXIsProcessTrusted(), NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid,
              let focused = focusedElement(target.pid), CFEqual(focused, target.focused), isEditable(focused) else { return false }
        if requireClipboard && NSPasteboard.general.changeCount != target.clipboardChange { return false }
        if let original = target.range {
            guard let current = selectedRange(focused), sameRange(original, current) else { return false }
        } else if requireRange { return false }
        return true
    }

    @objc private func pasteSelected(_ item: NSMenuItem) {
        guard let id = pending?.id else { return }
        afterMenuAction = { [weak self] in self?.paste(id: id, explicit: true) }
    }

    private func paste(id: String, explicit: Bool) {
        guard let current = pending, current.id == id, let text = current.result else { return }
        guard targetStillMatches(current.target, requireClipboard: !explicit, requireRange: !explicit) else {
            resultReady("The original insertion point is no longer focused. Restore it, or choose Copy result.")
            return
        }
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
            resultReady("macOS could not prepare the paste. Choose Copy result.")
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            resultReady("macOS could not write the result to the clipboard. Try Copy result.")
            return
        }
        let writtenChange = pasteboard.changeCount
        // No activation request is made. Check once more immediately before posting.
        guard targetStillMatches(current.target, requireClipboard: false, requireRange: !explicit),
              pasteboard.changeCount == writtenChange else {
            resultReady("The destination changed before paste. The result is on your clipboard.")
            return
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.postToPid(current.target.pid)
        up.postToPid(current.target.pid)
        pending = nil
        pendingMessage = nil
        emit(["type": "pasted", "id": id, "targetApp": current.target.name,
              "message": "Paste command sent. The destination app has not confirmed insertion."])
        showTransient("Paste sent to \(current.target.name)")
    }

    @objc private func copySelected(_ item: NSMenuItem) {
        guard let current = pending, let text = current.result else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else { report("macOS could not copy the result."); return }
        pending = nil
        pendingMessage = nil
        emit(["type": "result_ready", "id": current.id, "copied": true, "message": "Result copied. Paste it where you want."])
        showTransient("Result copied")
    }

    @objc private func cancelSelected(_ item: NSMenuItem) { cancelPending(emitEvent: true) }
    @objc private func openDashboard(_ item: NSMenuItem) { afterMenuAction = { emit(["type": "dashboard"]) } }

    private func cancelPending(emitEvent: Bool) {
        let id = pending?.id
        pending = nil
        pendingMessage = nil
        hideProgress()
        if emitEvent, let id {
            // Inference may already be complete; report the discarded result's
            // identity so its activity row no longer claims it can be pasted.
            emit(["type": "cancelled", "id": id])
        }
    }

    private func resultReady(_ message: String) {
        guard let current = pending else { return }
        pendingMessage = "Result ready — paste or copy above"
        emit(["type": "result_ready", "id": current.id, "message": message])
        showTransient("Result ready — shortcut, then right-click to paste or copy")
    }

    private func safeMessage(_ value: String?) -> String {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "The transformation could not be completed. Try again." }
        return String(value.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) || $0 == "\n" }.prefix(500))
    }

    private func fail(id: String, message: String) {
        guard pending?.id == id else { return }
        pending = nil
        pendingMessage = nil
        hideProgress()
        emit(["type": "error", "id": id, "message": message])
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Paste Perfect could not transform the text"
            alert.informativeText = message
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    private func report(_ message: String) {
        emit(["type": "error", "message": message])
        showTransient(message)
    }

    private func showProgress(_ message: String, spinning: Bool = true) {
        hideProgress()
        let size = NSSize(width: 390, height: 54)
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let background = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        background.material = .hudWindow
        background.blendingMode = .behindWindow
        background.state = .active
        background.wantsLayer = true
        background.layer?.cornerRadius = 12
        let label = NSTextField(labelWithString: message)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.lineBreakMode = .byTruncatingTail
        label.frame = NSRect(x: spinning ? 42 : 16, y: 17, width: spinning ? 333 : 358, height: 20)
        background.addSubview(label)
        if spinning {
            let indicator = NSProgressIndicator(frame: NSRect(x: 16, y: 18, width: 17, height: 17))
            indicator.style = .spinning
            indicator.controlSize = .small
            indicator.startAnimation(nil)
            background.addSubview(indicator)
        }
        panel.contentView = background
        let mouse = NSEvent.mouseLocation
        let visible = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1000, height: 800)
        panel.setFrameOrigin(NSPoint(x: min(max(mouse.x + 14, visible.minX + 8), visible.maxX - size.width - 8),
                                     y: min(max(mouse.y - size.height - 14, visible.minY + 8), visible.maxY - size.height - 8)))
        panel.orderFrontRegardless()
        progress = panel
    }

    private func showTransient(_ message: String) {
        showProgress(message, spinning: false)
        let panel = progress
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak panel] in
            if self?.progress === panel { self?.hideProgress() }
        }
    }

    private func hideProgress() { progress?.orderOut(nil); progress = nil }

    func shutdown() {
        guard !shuttingDown else { return }
        shuttingDown = true
        generation += 1
        afterMenuAction = nil
        permissionTimer?.invalidate()
        disarm(preservingMouseUp: false)
        cancelPending(emitEvent: false)
        menu?.cancelTracking()
        closeDesktop?()
        NSApp.terminate(nil)
    }
}

// The native app owns the connection: an unrelated launcher never receives an
// IPC endpoint. Code, resources, and the child runtime are sealed together.
private enum DesktopHostError: Error { case invalidBundle, childIdentity, missingHome, invalidDataDirectory, invalidRedirectPort, entropyFailure }

// Chromium children inherit stdout, but their stdin is /dev/null. Only the
// validated main process receives this per-launch secret through its stdin.
func commandHasValidAuthentication(_ command: [String: Any], token: String) -> Bool {
    guard let supplied = command["token"] as? String else { return false }
    let actual = Array(supplied.utf8)
    let expected = Array(token.utf8)
    guard actual.count == 64, expected.count == 64 else { return false }
    var difference: UInt8 = 0
    for index in expected.indices { difference |= actual[index] ^ expected[index] }
    return difference == 0
}

private final class DesktopHost {
    private let process = Process()
    private let commands = Pipe()
    private let events = Pipe()

    static func childEnvironment() throws -> [String: String] {
        guard let account = getpwuid(getuid()), let home = account.pointee.pw_dir else { throw DesktopHostError.missingHome }
        var temporary = [CChar](repeating: 0, count: Int(PATH_MAX))
        let length = confstr(_CS_DARWIN_USER_TEMP_DIR, &temporary, temporary.count)
        guard length > 0, length <= temporary.count else { throw DesktopHostError.missingHome }
        var environment = ["HOME": String(cString: home), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                           "TMPDIR": String(cString: temporary), "LANG": "en_US.UTF-8", "PASTE_PERFECT_NATIVE_HOST": "1"]
        // These two documented application settings cannot load code. Keep test
        // storage isolated, but reject shared directories and symlink aliases.
        if let path = ProcessInfo.processInfo.environment["PASTE_PERFECT_DATA_DIR"] {
            let components = path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
            guard path.hasPrefix("/"), !components.isEmpty else { throw DesktopHostError.invalidDataDirectory }
            var prefix = ""
            var metadata = stat()
            for component in components {
                guard !component.isEmpty, component != ".", component != ".." else { throw DesktopHostError.invalidDataDirectory }
                prefix += "/" + component
                // Use lstat on every component: Foundation normalizes system
                // aliases such as /private/tmp back to /tmp, a symlink.
                guard lstat(prefix, &metadata) == 0, (metadata.st_mode & S_IFMT) == S_IFDIR else {
                    throw DesktopHostError.invalidDataDirectory
                }
            }
            guard metadata.st_uid == getuid(), (metadata.st_mode & 0o077) == 0 else { throw DesktopHostError.invalidDataDirectory }
            environment["PASTE_PERFECT_DATA_DIR"] = path
        }
        if let port = ProcessInfo.processInfo.environment["PASTE_PERFECT_REDIRECT_PORT"] {
            guard let number = UInt16(port), number > 0, String(number) == port else { throw DesktopHostError.invalidRedirectPort }
            environment["PASTE_PERFECT_REDIRECT_PORT"] = port
        }
        return environment
    }

    static func validatedCode(at url: URL) throws -> SecStaticCode {
        var code: SecStaticCode?
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, flags, nil) == errSecSuccess else { throw DesktopHostError.invalidBundle }
        return code
    }

    static func exactRequirement(_ code: SecStaticCode) throws -> SecRequirement {
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(code, [], &information) == errSecSuccess,
              let hash = (information as? [String: Any])?[kSecCodeInfoUnique as String] as? Data else {
            throw DesktopHostError.invalidBundle
        }
        let digest = hash.map { String(format: "%02x", $0) }.joined()
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString("cdhash H\"\(digest)\"" as CFString, [], &requirement) == errSecSuccess,
              let requirement else { throw DesktopHostError.invalidBundle }
        return requirement
    }

    static func validateBundle() throws -> (URL, SecRequirement) {
        let bundle = Bundle.main.bundleURL
        guard bundle.pathExtension == "app", Bundle.main.bundleIdentifier == "com.openai.siwc.paste-perfect.native" else {
            throw DesktopHostError.invalidBundle
        }
        let ownCode = try validatedCode(at: bundle)
        let ownRequirement = try exactRequirement(ownCode)
        var runningCode: SecCode?
        guard SecCodeCopySelf([], &runningCode) == errSecSuccess, let runningCode,
              SecCodeCheckValidity(runningCode, [], ownRequirement) == errSecSuccess else {
            throw DesktopHostError.invalidBundle
        }
        let child = bundle.appendingPathComponent("Contents/Frameworks/Paste Perfect Desktop.app")
        let code = try validatedCode(at: child)
        return (child.appendingPathComponent("Contents/MacOS/Electron"), try exactRequirement(code))
    }

    func start(onCommand: @escaping ([String: Any]) -> Void, onClose: @escaping () -> Void) throws {
        let (executable, requirement) = try Self.validateBundle()
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
            throw DesktopHostError.entropyFailure
        }
        let commandToken = random.map { String(format: "%02x", $0) }.joined()
        process.executableURL = executable
        process.arguments = [] // Never forward the launcher's command line.
        process.environment = try Self.childEnvironment()
        process.currentDirectoryURL = Bundle.main.bundleURL
        process.standardInput = events
        process.standardOutput = commands
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in DispatchQueue.main.async(execute: onClose) }
        try process.run()
        // Pin the running child to the code validated before launch, rather than
        // treating a process name, identifier, or stock Electron signature as trust.
        var childCode: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: process.processIdentifier] as CFDictionary,
                                             [], &childCode) == errSecSuccess, let childCode,
              SecCodeCheckValidity(childCode, [], requirement) == errSecSuccess else {
            process.terminate()
            throw DesktopHostError.childIdentity
        }
        desktopInput = events.fileHandleForWriting
        emit(["type": "transport-auth", "token": commandToken])
        DispatchQueue.global(qos: .utility).async { [self] in
            var buffer = Data()
            var desktopReady = false
            readLoop: while true {
                let bytes = commands.fileHandleForReading.availableData
                if bytes.isEmpty { break }
                buffer.append(bytes)
                // Bound before splitting so an unterminated or oversized command
                // cannot grow memory indefinitely.
                if buffer.count > 1_200_000 { break }
                while let newline = buffer.firstIndex(of: 10) {
                    let data = buffer[..<newline]
                    buffer.removeSubrange(...newline)
                    guard var command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                          commandHasValidAuthentication(command, token: commandToken) else { break readLoop }
                    command.removeValue(forKey: "token")
                    if command["type"] as? String == "desktop-ready" {
                        if !desktopReady {
                            desktopReady = true
                            FileHandle.standardError.write(Data("Paste Perfect desktop ready.\n".utf8))
                        }
                        continue
                    }
                    DispatchQueue.main.async { onCommand(command) }
                }
            }
            DispatchQueue.main.async(execute: onClose)
        }
    }

    func stop() {
        desktopInput = nil
        try? events.fileHandleForWriting.close()
        if process.isRunning { process.terminate() }
    }
}

#if !PASTE_PERFECT_NATIVE_TESTS
guard #available(macOS 14.0, *) else { exit(1) }
signal(SIGPIPE, SIG_IGN)
if CommandLine.arguments.contains("--verify-bundle") {
    do { _ = try DesktopHost.validateBundle(); exit(0) }
    catch { FileHandle.standardError.write(Data("Paste Perfect bundle validation failed.\n".utf8)); exit(1) }
}
let application = NSApplication.shared
private let controller = NativeController()
application.delegate = controller
private let desktop = DesktopHost()
closeDesktop = { desktop.stop() }
do {
    try desktop.start(onCommand: { controller.handle($0) }, onClose: { controller.shutdown() })
} catch {
    let reason = (error as? DesktopHostError).map { String(describing: $0) } ?? "launchFailed"
    FileHandle.standardError.write(Data("Paste Perfect could not verify or start its sealed desktop app (\(reason)). Run npm run build and try again.\n".utf8))
    exit(1)
}
private var shutdownSignals: [DispatchSourceSignal] = []
for number in [SIGINT, SIGTERM] {
    signal(number, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { controller.shutdown() }
    source.resume()
    shutdownSignals.append(source)
}
application.run()
desktop.stop()
#endif
