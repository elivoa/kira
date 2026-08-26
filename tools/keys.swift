// 全局方向键监听：CGEventTap 只关心 keyDown 里的方向键，按一次往 stdout 打一行 "arrow"
// 需要「输入监控」权限（macOS 会在首次运行时弹授权，或在 系统设置→隐私与安全性→输入监控 里开）；
// 没权限时 tap 创建失败，打日志退出非零，主进程据此降级为只检测鼠标
import Cocoa
import CoreGraphics

let arrowCodes: Set<Int64> = [123, 124, 125, 126] // 左 右 下 上
var theTap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
  // 系统超时禁用了 tap 要重新启用，否则监听悄悄死掉
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let t = theTap { CGEvent.tapEnable(tap: t, enable: true) }
    return nil
  }
  if type == .keyDown, arrowCodes.contains(event.getIntegerValueField(.keyboardEventKeycode)) {
    print("arrow")
    fflush(stdout)
  }
  return Unmanaged.passUnretained(event)
}

theTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .listenOnly, // 只听不改，方向键照常传给前台应用
  eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
  callback: callback,
  userInfo: nil
)

guard let tap = theTap else {
  FileHandle.standardError.write("CGEventTap 创建失败：缺少「输入监控」权限\n".data(using: .utf8)!)
  exit(1)
}
let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("keys monitor ready\n".data(using: .utf8)!)
CFRunLoopRun()
