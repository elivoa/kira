// 列出屏幕上可见的普通窗口（JSON），供桌宠寻找可以站立的边缘
// 输出: [{"x":..,"y":..,"w":..,"h":..,"owner":"..","pid":..,"name":".."}]
import CoreGraphics
import Foundation

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
var out: [[String: Any]] = []
for w in list {
  guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
        let bounds = w[kCGWindowBounds as String] as? [String: CGFloat],
        let owner = w[kCGWindowOwnerName as String] as? String,
        let pid = w[kCGWindowOwnerPID as String] as? Int,
        let x = bounds["X"], let y = bounds["Y"],
        let width = bounds["Width"], let height = bounds["Height"],
        width >= 150, height >= 150
  else { continue }
  out.append([
    "x": x, "y": y, "w": width, "h": height,
    "owner": owner, "pid": pid,
    "name": (w[kCGWindowName as String] as? String) ?? "",
  ])
}
let data = try JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
