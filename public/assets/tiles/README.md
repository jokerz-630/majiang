# Mahjong Tile Assets

当前页面已经预留麻将牌素材接入位。

## 目录

把素材放在：`public/assets/tiles/`

## 命名规则

正面牌按下面命名：

- `wan-1.png` 到 `wan-9.png`
- `tong-1.png` 到 `tong-9.png`
- `tiao-1.png` 到 `tiao-9.png`
- `honor-east.png`
- `honor-south.png`
- `honor-west.png`
- `honor-north.png`
- `honor-zhong.png`
- `honor-fa.png`
- `honor-bai.png`

反面统一使用：

- `tile-back.png`

## 推荐规格

- 正面牌比例：`54 x 78` 的同比例，推荐 2x 导出为 `108 x 156`
- 反面牌比例：与正面相同
- 文件格式：优先 `png`
- 背景：建议透明背景或已裁切干净的矩形牌面

## 接入方式

当前样式已经预留 CSS 变量：

- `--tile-front-image`
- `--tile-back-image`

后续接入真实素材时，可以按牌名把 `data-asset` 映射到对应图片路径，再把图片地址写入按钮的内联 CSS 变量。

如果你提供素材，我下一步可以直接帮你把图片映射逻辑接上。
