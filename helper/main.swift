import AppKit
import ApplicationServices
import Foundation

let KEYCODE_FN: Int64 = 63
let KEYCODE_RIGHT_OPTION: Int64 = 61
let DOUBLE_TAP_WINDOW: TimeInterval = 0.45

let outputQueue = DispatchQueue(label: "purpur.output")
var eventTap: CFMachPort?
var currentTrigger = "option-hold"
var holdActive = false
var lastFnDown: TimeInterval = 0
var fnArmedByDoubleTap = false
var tapHealthy = false

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
  outputQueue.async {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

func now() -> TimeInterval { Date().timeIntervalSince1970 }

func permissionsSnapshot() -> [String: Any] {
  [
    "accessibility": AXIsProcessTrusted(),
    "inputMonitoring": tapHealthy
  ]
}

func focusedElement() -> AXUIElement? {
  let system = AXUIElementCreateSystemWide()
  var focused: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
  guard err == .success, let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() else {
    return nil
  }
  return (value as! AXUIElement)
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return err == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String, limit: Int) -> String? {
  guard let value = attribute(element, name) else { return nil }
  guard let text = value as? String, !text.isEmpty else { return nil }
  return String(text.prefix(limit))
}

func collectContext() -> [String: Any] {
  var context: [String: Any] = [:]
  if let front = NSWorkspace.shared.frontmostApplication {
    context["app"] = front.localizedName ?? "unknown"
    context["bundleId"] = front.bundleIdentifier ?? ""
    context["pid"] = Int(front.processIdentifier)
  }
  guard let element = focusedElement() else { return context }
  context["role"] = stringAttribute(element, kAXRoleAttribute as String, limit: 64) ?? ""
  context["field"] = stringAttribute(element, kAXDescriptionAttribute as String, limit: 120)
    ?? stringAttribute(element, kAXTitleAttribute as String, limit: 120)
    ?? stringAttribute(element, kAXPlaceholderValueAttribute as String, limit: 120)
    ?? ""
  context["selectedText"] = stringAttribute(element, kAXSelectedTextAttribute as String, limit: 400) ?? ""
  context["value"] = stringAttribute(element, kAXValueAttribute as String, limit: 1200) ?? ""
  return context
}

func pasteText(_ text: String) -> Bool {
  let pasteboard = NSPasteboard.general
  let saved = pasteboard.string(forType: .string)
  pasteboard.clearContents()
  pasteboard.setString(text, forType: .string)
  guard let source = CGEventSource(stateID: .combinedSessionState) else { return false }
  let vKey: CGKeyCode = 9
  guard
    let down = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: true),
    let up = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: false)
  else { return false }
  down.flags = .maskCommand
  up.flags = .maskCommand
  down.post(tap: .cghidEventTap)
  up.post(tap: .cghidEventTap)
  if let previous = saved {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
      pasteboard.clearContents()
      pasteboard.setString(previous, forType: .string)
    }
  }
  return true
}

func insertText(_ text: String) -> (String, Bool, String?) {
  if let element = focusedElement() {
    var settable: DarwinBoolean = false
    let check = AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable)
    if check == .success && settable.boolValue {
      let set = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
      if set == .success {
        return ("ax", true, nil)
      }
      return ("ax", false, "AXUIElementSetAttributeValue failed (\(set.rawValue))")
    }
  }
  let pasted = pasteText(text)
  return ("paste", pasted, pasted ? nil : "failed to post Cmd+V")
}

func emitHotkey(_ phase: String, source: String) {
  emit(["type": "event", "event": "hotkey", "phase": phase, "source": source])
}

func handleFlagsChanged(keycode: Int64, flags: CGEventFlags) {
  let fnDown = flags.contains(.maskSecondaryFn)
  switch currentTrigger {
  case "fn-hold":
    let isFnKey = keycode == KEYCODE_FN
    if !isFnKey { return }
    if fnDown && !holdActive {
      holdActive = true
      emitHotkey("start", source: "fn-hold")
    } else if !fnDown && holdActive {
      holdActive = false
      emitHotkey("stop", source: "fn-hold")
    }
  case "fn-doubletap":
    let isFnKey = keycode == KEYCODE_FN
    if !isFnKey || !fnDown { return }
    let t = now()
    if t - lastFnDown <= DOUBLE_TAP_WINDOW {
      lastFnDown = 0
      fnArmedByDoubleTap.toggle()
      emitHotkey(fnArmedByDoubleTap ? "start" : "stop", source: "fn-doubletap")
    } else {
      lastFnDown = t
    }
  case "option-hold":
    guard keycode == KEYCODE_RIGHT_OPTION else { return }
    let optionDown = flags.contains(.maskAlternate)
    if optionDown && !holdActive {
      holdActive = true
      emitHotkey("start", source: "option-hold")
    } else if !optionDown && holdActive {
      holdActive = false
      emitHotkey("stop", source: "option-hold")
    }
  default:
    return
  }
}

func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    return Unmanaged.passUnretained(event)
  }
  let keycode = event.getIntegerValueField(.keyboardEventKeycode)
  if type == .flagsChanged {
    handleFlagsChanged(keycode: keycode, flags: event.flags)
  } else if type == .keyDown {
    lastFnDown = 0
  }
  return Unmanaged.passUnretained(event)
}

func installTap() -> Bool {
  let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
  guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(mask),
    callback: tapCallback,
    userInfo: nil
  ) else {
    return false
  }
  eventTap = tap
  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  return true
}

func handleCommand(_ object: [String: Any]) {
  guard let cmd = object["cmd"] as? String else { return }
  let id = object["id"] as? Int
  func respond(_ payload: [String: Any]) {
    var out = payload
    if let id { out["id"] = id }
    out["ok"] = out["ok"] ?? true
    emit(out)
  }
  switch cmd {
  case "set-trigger":
    if let trigger = object["trigger"] as? String {
      currentTrigger = trigger
      holdActive = false
      fnArmedByDoubleTap = false
    }
    respond(["type": "ack", "trigger": currentTrigger])
  case "context":
    respond(["type": "context", "context": collectContext()])
  case "insert":
    let text = object["text"] as? String ?? ""
    let (method, ok, error) = insertText(text)
    respond(["type": "insert-result", "method": method, "ok": ok, "error": error as Any])
  case "permissions":
    respond(["type": "permissions", "permissions": permissionsSnapshot()])
  case "quit":
    respond(["type": "bye"])
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { exit(0) }
  default:
    respond(["type": "error", "ok": false, "error": "unknown command \(cmd)"])
  }
}

func stdinLoop() {
  var buffer = Data()
  while true {
    let chunk = FileHandle.standardInput.availableData
    if chunk.isEmpty { break }
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 0x0A) {
      let line = buffer.subdata(in: 0..<newline)
      buffer.removeSubrange(0...newline)
      guard !line.isEmpty else { continue }
      if let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] {
        handleCommand(object)
      }
    }
  }
  exit(0)
}

signal(SIGPIPE, SIG_IGN)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let trusted = AXIsProcessTrustedWithOptions(
  [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
)
tapHealthy = installTap()

emit([
  "type": "event",
  "event": "ready",
  "trigger": currentTrigger,
  "permissions": permissionsSnapshot(),
  "axPrompted": !trusted
])

Thread.detachNewThread { stdinLoop() }
app.run()
