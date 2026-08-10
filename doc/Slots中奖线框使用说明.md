# Slots 中奖线框 Shader

## 接入

1. 回到 Cocos Creator，等待新增资源自动导入（不要手动创建 `.meta`）。
2. 新建一个 UI 节点，让它的 `UITransform` 尺寸覆盖整个 slots 中奖显示区域。
3. 给节点添加 `SlotsWinRenderer`。它要求同节点有 `Sprite`，编辑器会自动补上。
4. 将 `assets/resources/effects/slots-win-line-frame.effect` 拖到组件的 `Effect Asset`。不拖也可以，运行时会从 `resources` 自动加载；拖入后可直接看到编辑器预览。
5. 填写 `Line Points` 和 `Frames`。所有位置、线宽、框宽、矩形宽高、圆半径都按此节点的本地像素坐标填写。

坐标原点就是节点锚点。例如默认锚点 `(0.5, 0.5)` 时，节点中心是 `(0, 0)`，右上为正，左下为负。

```mermaid
flowchart LR
    A["本地坐标配置"] --> B["SlotsWinRenderer 打包 uniform"]
    B --> C["SDF Shader 计算线段/矩形/圆距离"]
    C --> D["纹理或纯色着色"]
    D --> E["平滑抗锯齿合成"]
```

## 主要选项

- `Draw Mode`：只画线、只画框、同时画线框。
- `Layer Order`：控制线与框重叠时的上下关系。
- `Draw Line Inside Frames`：关闭后，中奖框内部的中奖线会被平滑裁掉。
- `Use Line Texture / Use Frame Texture`：关闭时使用纯色；开启时采样纹理并乘对应颜色。
- `Line Texture Repeat`：中奖线纹理沿整条折线每多少像素重复一次。
- `Antialias Softness`：一般保持 `1`，数值越大边缘越柔和。

纹理建议使用带透明通道的无缝图片，并在纹理导入设置中使用线性过滤。中奖线纹理的横轴沿折线方向，纵轴横跨线宽。

## 运行时调用

```ts
import { Vec2 } from 'cc';
import { SlotsWinRenderer } from './slots/SlotsWinRenderer';

const renderer = node.getComponent(SlotsWinRenderer)!;

// 坐标均相对 renderer 所在节点的锚点，单位是像素。
renderer.setLinePoints([
    new Vec2(-320, 120),
    new Vec2(-160, -80),
    new Vec2(0, 80),
    new Vec2(160, -80),
    new Vec2(320, 120),
]);
```

直接修改组件公开字段后，调用一次 `syncNow()` 即可上传。组件对折线点和框的总数不设上限；内部会自动拆成多个兼容 WebGL1 的小批次。数据越多 draw call 越多，例如 100 个线段约为 7 批、100 个框约为 7 批。
