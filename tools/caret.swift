// 一次性查询系统焦点输入区的文本光标（caret）屏幕矩形，打到 stdout 后退出，非常驻
// 成功打一行 JSON：{"x":..,"y":..,"width":..,"height":..,"kind":"caret|frame","role":"AXTextArea"|...}
// （坐标是 Quartz 屏幕坐标，左上角原点；kind=caret 是 marker range 精确光标行，frame 是元素整体回退）；
// 无「辅助功能」权限、无焦点输入框、取不到位置时都静默 exit(0)，主进程按 null 处理
import Cocoa
import ApplicationServices

// 从 AXValue 解出 CGRect/CGPoint/CGSize，失败返回 nil
func axRect(_ v: CFTypeRef) -> CGRect? {
  guard CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
  let av = v as! AXValue
  var rect = CGRect.zero
  if AXValueGetType(av) == .cgRect, AXValueGetValue(av, .cgRect, &rect) { return rect }
  var pt = CGPoint.zero
  if AXValueGetType(av) == .cgPoint, AXValueGetValue(av, .cgPoint, &pt) { return CGRect(origin: pt, size: .zero) }
  var sz = CGSize.zero
  if AXValueGetType(av) == .cgSize, AXValueGetValue(av, .cgSize, &sz) { return CGRect(origin: .zero, size: sz) }
  return nil
}

func axPoint(_ v: CFTypeRef) -> CGPoint? {
  guard CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
  var pt = CGPoint.zero
  return AXValueGetValue(v as! AXValue, .cgPoint, &pt) ? pt : nil
}

func axSize(_ v: CFTypeRef) -> CGSize? {
  guard CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
  var sz = CGSize.zero
  return AXValueGetValue(v as! AXValue, .cgSize, &sz) ? sz : nil
}

func copyAttr(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
  return v
}

// bounds-for-marker-range 是参数化属性，参数是 marker range 的 AXValue
func copyParamAttr(_ el: AXUIElement, _ attr: String, _ param: CFTypeRef) -> CFTypeRef? {
  var v: CFTypeRef?
  guard AXUIElementCopyParameterizedAttributeValue(el, attr as CFString, param, &v) == .success else { return nil }
  return v
}

var caret: CGRect?
var caretKind = "frame" // caret=marker range 精确光标行；frame=元素整体 frame 回退
var caretRole: String? // 焦点元素 role，主进程据此过滤非文本焦点（Finder 列表/按钮等不该框）

// systemwide 的 focused 查询依赖 NSApplication 初始化：纯 CLI 从不跑 RunLoop 时，
// 查 kAXFocusedUIElement/kAXFocusedApplication 恒返回 err -25204 (NoValue)——授权正常也拿不到值。
// 先拉起 NSApp 并转一小段 RunLoop；实测 0.05s 就够，取 0.15s 留余量
// （不能太长：main.js getCaret 的 execFile timeout 有限，0.3s 时冷启动总耗时会超）
let nsApp = NSApplication.shared
nsApp.setActivationPolicy(.accessory)
let spinEnd = Date().addingTimeInterval(0.15)
while Date() < spinEnd { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }

let sys = AXUIElementCreateSystemWide()
if let focused = copyAttr(sys, kAXFocusedUIElementAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
  let el = focused as! AXUIElement
  caretRole = copyAttr(el, kAXRoleAttribute) as? String
  // 优先用 marker range 拿精确光标矩形；取不到就退回元素整体 frame
  if let range = copyAttr(el, kAXSelectedTextMarkerRangeAttribute),
     let bounds = copyParamAttr(el, "AXBoundsForTextMarkerRange", range), // Swift SDK 未导出该常量
     let r = axRect(bounds) {
    caret = r
    caretKind = "caret"
  } else if let pos = copyAttr(el, kAXPositionAttribute).flatMap(axPoint),
            let sz = copyAttr(el, kAXSizeAttribute).flatMap(axSize) {
    caret = CGRect(origin: pos, size: sz)
  }
}

if let r = caret {
  // JSON 数字不保留多余小数，坐标取两位够用
  func n(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }
  let roleJSON = caretRole.map { "\"\($0)\"" } ?? "null"
  print("{\"x\":\(n(r.origin.x)),\"y\":\(n(r.origin.y)),\"width\":\(n(r.size.width)),\"height\":\(n(r.size.height)),\"kind\":\"\(caretKind)\",\"role\":\(roleJSON)}")
}
exit(0)
