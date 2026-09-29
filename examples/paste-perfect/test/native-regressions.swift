// The test runner appends this file to the unmodified native source. Swift's
// file-scoped private access lets us exercise the controller without exposing
// testing commands over IPC or starting an app, event tap, or clipboard action.
extension NativeController {
    static func runRegressionCase(_ name: String) {
        let controller = NativeController()
        switch name {
        case "recipes":
            let custom = (1...100).map { ["id": "custom-\($0)", "name": "Custom \($0)"] }
            let builtins = builtinRecipes.map { ["id": $0.0, "name": $0.1] }
            controller.handle(["type": "configure", "connected": true, "recipes": builtins + custom])
            precondition(controller.recipes.map { $0.0 } == custom.map { $0["id"]! },
                         "All 100 custom recipes must survive the built-in filter")
            let duplicate = ["id": "custom-1", "name": "Duplicate"]
            let invalid = ["id": "", "name": "Invalid"]
            let overflow = ["id": "custom-101", "name": "Beyond the custom limit"]
            controller.handle(["type": "configure", "connected": true,
                               "recipes": builtins + [invalid, custom[0], duplicate] + Array(custom.dropFirst()) + [overflow]])
            precondition(controller.recipes.map { $0.0 } == custom.map { $0["id"]! },
                         "Only valid, distinct custom recipes count toward the limit")
        case "cancel-running":
            controller.installPendingForRegression(id: "running-request", ready: false)
            controller.handle(["type": "cancel", "id": "running-request"])
            precondition(controller.pending == nil)
        case "discard-ready":
            controller.installPendingForRegression(id: "completed-result", ready: true)
            controller.afterMenuAction = { preconditionFailure("A discarded menu action must never execute") }
            // Account changes and tray cancellation have no active inference ID
            // once the response has completed.
            controller.handle(["type": "cancel"])
            precondition(controller.pending == nil && controller.afterMenuAction == nil)
            controller.handle(["type": "cancel"])
        case "stale-cancel":
            controller.installPendingForRegression(id: "replacement-request", ready: false)
            controller.handle(["type": "cancel", "id": "previous-request"])
            precondition(controller.pending?.id == "replacement-request")
            controller.handle(["type": "cancel", "id": "replacement-request"])
            precondition(controller.pending == nil)
        case "menu-discard":
            controller.installPendingForRegression(id: "menu-result", ready: true)
            controller.cancelSelected(NSMenuItem(title: "Discard result", action: nil, keyEquivalent: ""))
            precondition(controller.pending == nil)
        case "cancel-empty":
            controller.handle(["type": "cancel"])
            controller.handle(["type": "cancel", "id": "already-delivered"])
            precondition(controller.pending == nil)
        case "late-result":
            controller.installPendingForRegression(id: "cancelled-request", ready: false)
            controller.handle(["type": "cancel"])
            controller.handle(["type": "result", "id": "cancelled-request", "text": "Synthetic late result"])
            precondition(controller.pending == nil)
        default:
            preconditionFailure("Unknown regression case")
        }
    }

    private func installPendingForRegression(id: String, ready: Bool) {
        let target = Target(pid: getpid(), name: "Synthetic destination",
                            focused: AXUIElementCreateApplication(getpid()), range: nil,
                            clipboardChange: 0, text: "Synthetic input")
        pending = Pending(id: id, target: target, result: ready ? "Synthetic result" : nil)
    }
}

NativeController.runRegressionCase(CommandLine.arguments[1])
