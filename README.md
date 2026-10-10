# 竹喵的撸猫地图

从 `icewindwillow/map` 的本地提交 `16f1379` 独立复制，保留原项目历史。原仓库不作修改。

- 新仓库：`icewindwillow/zhumiao-cat-map`
- 本地预览：`npm run dev`
- 检查：`npm run check`
- 当前底图、搜索范围及已有地点/照片继承原英国地图；猫咪地点尚待整理。
- 如需上线，在 Cloudflare Pages 新建项目并连接新仓库，输出目录填写 `public`。作者后台需单独配置 D1 数据库、Cloudflare Access 与作者邮箱，勿绑定原地图数据库。
- 不复制旧项目的部署环境、密钥或线上数据库。

---

以下为原项目文档，供技术参考。

# 谢老师的英国旅行 · 记忆地图 v0.2

淡彩手账风格的英国互动地图。继续使用 `public/` 静态部署结构，不需要安装前端依赖，不需要数据库、Vercel 或 API Key。

## 先上传这一版

先保留当前仓库的提交，再将本代码包里的 `public/`、`scripts/`、`tests/`、`package.json` 等文件放到仓库根目录的对应位置。

```text
map/                         ← Git 仓库根目录
├── public/
│   ├── index.html
│   ├── _headers             ← 必须一起更新，旧版 CSP 会阻止街道底图
│   ├── assets/
│   │   ├── app.js
│   │   ├── geo.js
│   │   ├── style.css
│   │   └── favicon.svg
│   └── data/
│       ├── memories.json    ← 真实故事；已有内容时请保留你自己的版本
│       ├── demos.json       ← 8 个独立的演示地点
│       ├── uk-overview.geojson
│       ├── SOURCES.txt
│       └── licenses/
├── scripts/
├── tests/
├── package.json
└── README.md
```

不要把 ZIP 本身放进 `public/`，也不要在仓库根目录额外套一层 `uk-memory-map-v0.2/`。上传解压后的文件内容。

**如果你已经加入了真实故事，保留原来的 `public/data/memories.json`。**包内此文件是空数组，不应覆盖已有记录。演示内容单独放在 `demos.json`，不会自动写入真实故事。

Cloudflare Pages 沿用原设置：

| 项目 | 值 |
|---|---|
| 框架 | 无 / None |
| 生产分支 | 你已经连接的分支（通常为 main） |
| 构建命令 | `exit 0` |
| 构建输出目录 | `public` |
| 根目录 | 留空 |
| 环境变量 | 不需要 |

推送后，在 Cloudflare 的部署记录里确认最新提交部署成功，再打开你自己的 `pages.dev` 地址。此代码包没有替你推送或创建云端项目。

## 已有功能

- 奶油色陆地、灰蓝海洋、墨绿色界面、砖红色地点与纸张颗粒。
- 真实海岸线的矢量总览，随站点一起提供，不依赖外部脚本或在线瓦片才能打开。
- 鼠标拖动、滚轮缩放、双击放大、按钮缩放与英国全览复位。
- 移动端拖动、双指缩放与适配手机的故事底部卡片。
- 城市级坐标标记，近距离标记自动聚合，点开聚合后放大；标签做避让。
- 城市中英文搜索、地区筛选、演示地点开关。
- 地点故事卡、上一页/下一页、键盘关闭、原焦点返回。
- 屏幕阅读器标签、键盘地图操作、减少动态效果偏好支持。
- 既有的无坐标故事仍可阅读，显示“定位待补”，不猜测地点。
- 可选的在线街道底图入口；加载失败时保持本地总览。

键盘：搜索按 `/`，故事关闭按 `Escape`；聚焦地图后，方向键移动、`+` / `-` 缩放，`Home` 回到英国全览。

搜索只针对本站已收录内容；它不是全英国地址搜索或地理编码服务。筛选影响标记与列表，不改变底图的真实地理位置。

## 两种底图的区别

### 手账总览（默认）

使用 GSHHG 2.3.6，经 `basemap-data 2.0.0` 提取英国周边的中等分辨率海岸线、湖泊和国家边界。坐标采用 WGS84，前端使用墨卡托投影。

这不是凭印象手画的轮廓，但它经过制图概括化，**不是测绘级、导航级或街道级数据**。放大上限是有意限制的，不会伪装出不存在的道路细节。

初始取景包含英国本土及北部岛屿，包含北爱尔兰、奥克尼和设得兰区域。周边爱尔兰、欧洲大陆与岛屿作为地理参照出现；相同陆地填色不表示它们属于英国。总览没有绘制完整的英国地方行政区划。

对应源数据、许可及可重现生成脚本均已提供；详见 `public/data/SOURCES.txt` 与 `scripts/generate-geography.py`。部署网站不需要执行这个 Python 脚本。

### 街道底图（需要联网）

点击右上角“街道底图”，按需加载：

- MapLibre GL JS 5.6.1，先尝试 jsDelivr，失败再尝试 unpkg；版本固定以避免无意升级。
- OpenFreeMap 的 Positron 矢量底图，运行时应用淡彩配色。
- OpenMapTiles / OpenStreetMap 底图来源署名保留在地图右下角。

入口不需要 API Key。外部服务可用性、浏览器 WebGL 支持、所在网络、广告拦截器等都会影响加载。当前执行环境无法实测外部瓦片服务，因此**在线街道底图的成功显示仍需在你的部署地址验证**；本地总览与失败回退已测试。

`public/_headers` 已允许所需 CDN、地图请求、内联样式与 blob worker。必须随网页一起上传，不能继续保留 v0.1 中仅允许同源请求的旧策略。

来源：
- https://openfreemap.org/quick_start/
- https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- https://www.openstreetmap.org/copyright
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## 示例不是真实经历

8 个演示城市为伦敦、爱丁堡、牛津、巴斯、卡迪夫、约克、因弗内斯、贝尔法斯特。坐标只是城市中心附近的示意位置，不是已经核实的事件发生点。

没有虚构她的旅行日期、访问记录或照片。“真实故事”计数保持 0。取消“显示演示地点”，就会得到一张等待内容的地图。

当 `memories.json` 中已有真实故事时，演示地点默认关闭；可以手动再打开对照。占位照片只是文字卡片，不是虚构的旅行照片。

## 以后怎么加入一条真实故事

仍使用 `public/data/memories.json`，保留 `schemaVersion: 1`：

```json
{
  "schemaVersion": 1,
  "memories": [
    {
      "id": "my-first-memory",
      "title": "这里填写真实的故事标题",
      "place": "伦敦",
      "placeEn": "London",
      "region": "england",
      "coordinates": [-0.1276, 51.5072],
      "locationPrecision": "仅定位到城市；具体地点待确认",
      "category": "日常",
      "date": "",
      "description": "这里填写她自己的故事。示例坐标不是事件发生地点。"
    }
  ]
}
```

`id` 唯一，`title` 必填。坐标格式是 **[经度, 纬度]**，不要倒过来。没有可靠位置时直接不填 `coordinates`，文字仍会保留。

地区字段仅支持 `england`、`scotland`、`wales`、`northernIreland`；也可以暂时不填。

以后添加照片时，先放进 `public/assets/photos/`，然后加：

```json
"photo": "./assets/photos/my-photo.webp",
"photoAlt": "对这张照片的简短描述"
```

照片支持本地 PNG、JPG、JPEG、WebP、AVIF。现在不提供上传后台，不会把浏览器临时操作当作持久保存。

## 预览与检查

正常项目预览（Node 20 或更高版本，不需要 npm install）：

```bash
npm run dev
```

终端会显示本地预览地址。`public/index.html` 依赖读取旁边的数据文件，不建议直接双击；直接双击应使用另外提供的 `uk-map-v0.2-preview.html`。

生成单文件预览：

```bash
node scripts/build-preview.mjs preview.html
```

单文件预览内嵌总览与演示数据，可离线试用总览；可选街道图仍需要联网。不要用单文件预览去覆盖正式的 `public/index.html`，正式部署保留分文件结构与安全响应头。

单元与静态检查：

```bash
npm run check
```

本次验证：16 项 Node 检查通过；26 项离线 Chromium 界面与交互检查通过，包括 390px / 320px 手机、聚合展开、搜索与筛选、旧数据兼容、内容注入防护与在线层失败回退。结果在 `TEST-RESULTS.json`。

这些不是 Cloudflare 线上部署测试，也不是外部街道瓦片成功加载测试。

## 隐私

没有新增分析追踪、定位授权、登录、后端或云端写入操作。默认总览只读取本站文件；点击街道底图后，浏览器会连接相关 CDN 和地图服务。

`noindex` 只是搜索引擎提示，**不是访问控制**。公开 GitHub 仓库与公开 Pages 网站上的内容不应视为私密。后续加入住址、人物照片或敏感经历前，请先确认公开范围与当事人同意。
