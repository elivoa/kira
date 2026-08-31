// 一次性查询系统焦点输入区的文本光标（caret）屏幕矩形，打到 stdout 后退出，非常驻
// 成功打一行 JSON：{"x":..,"y":..,"width":..,"height":..}（Quartz 屏幕坐标，左上角原点）；
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

let sys = AXUIElementCreateSystemWide()
if let focused = copyAttr(sys, kAXFocusedUIElementAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
  let el = focused as! AXUIElement
  // 优先用 marker range 拿精确光标矩形；取不到就退回元素整体 frame
  if let range = copyAttr(el, kAXSelectedTextMarkerRangeAttribute),
     let bounds = copyParamAttr(el, "AXBoundsForTextMarkerRange", range), // Swift SDK 未导出该常量
     let r = axRect(bounds) {
    caret = r
  } else if let pos = copyAttr(el, kAXPositionAttribute).flatMap(axPoint),
            let sz = copyAttr(el, kAXSizeAttribute).flatMap(axSize) {
    caret = CGRect(origin: pos, size: sz)
  }
}

if let r = caret {
  // JSON 数字不保留多余小数，坐标取两位够用
  func n(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }
  print("{\"x\":\(n(r.origin.x)),\"y\":\(n(r.origin.y)),\"width\":\(n(r.size.width)),\"height\":\(n(r.size.height))}")
}
exit(0)
