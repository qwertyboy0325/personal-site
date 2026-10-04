# personal-site

單頁個人網站，主題是「光」：照片、用物理算出來的光（黑洞渲染器），以及被拆成字元的光。純 HTML / CSS / JavaScript：沒有框架、沒有第三方資源、應用本身不需要 build。

頁面依序是：首屏 → 最近 → 照片 → 實驗 → 工作 → 關於 → 鏡子 → 聯絡。每張圖第一次出現時都會**從字元顯影成照片**（首屏是解析度一段一段升高、照片從中心溶解、黑洞由亮帶掃描），拍攝參數同時跳到真實數值；標題與名稱也用同一套字元「顯影」。首屏在滑鼠底下會變成手電筒；「關於」的 ASCII 臉會看著游標；最後的「鏡子」用你的相機在燈箱上把你畫成字元，有快門與可複製的印樣。

原本的終端機還在：按 `~`（或點左下角那行指令列）從底部拉出來，指令、補全、歷史、彩蛋都一樣；輸入 `photos`、`about` 這類指令時，後面的頁面會捲到對應的區塊。

## 執行

```sh
npm run dev      # http://127.0.0.1:5173，含熱重載（ES modules 需要 http://，不能用 file://）
npm run check    # 預渲染是否同步 + 全部單元測試
npm run e2e      # 真實 Chrome 的端對端測試（需要 Chrome，可用 CHROME=/path/to/chrome 指定）
npm run build    # 重新產生 index.html 內的預渲染區塊
```

需要 Node 20 以上。`npm run e2e` 會把截圖存到 `.shots/`（已加入 .gitignore）。

**熱重載**：`npm run dev` 會監看專案，改檔存檔後已開啟的頁面自動更新。
- 改 `.css`：只換樣式，**不重新整理**，頁面狀態（已輸入的指令、主題等）保留。
- 改 `.js` / `.html` / `.svg` / `.json`：自動重新載入。
- 改 `test/`、`scripts/`、`README.md`、`.git`、`.shots`：忽略。
- 改 `src/content.js`、`page.js`、`render.js`、`fx/face.js`、`fx/rain.js` 時，終端機會提醒你跑 `npm run build`，因為這些會影響 `index.html` 內預渲染的無 JS 內容（伺服器不會替你改寫檔案）。
- 開發伺服器支援 HTTP Range（分段傳輸）：**Safari 沒有它就不會播放 `<video>`**。
- 熱重載的腳本與放寬的 CSP（`connect-src 'self'`）只在伺服器回應時注入，磁碟上的 `index.html` 與部署的內容不受影響。`LIVERELOAD=0 npm run dev` 可關閉。
- 存檔後頁面沒反應時，先看執行 `npm run dev` 的終端機有沒有印出 `reload` 或 `css` 的訊息；沒有的話代表該檔案屬於被忽略的類型。

## 頁面

| 區塊 | 內容（都在 `src/content.js`） |
|---|---|
| 首屏 | `home.hero` 的照片 + 名字 + `ui[lang].page.line` 一句話；照片從字元顯影、拍攝參數跳到真值；滑鼠移上去變手電筒 |
| 最近 | `ui[lang].page.now.items`：「正在做／正在想」，一行一句，改字就能更新 |
| 照片 | `home.photos` 選的 6 張（順序決定版型：大、直、三張直幅、全景），點開是檢視器；「看全部」在終端機打開 `photos` |
| 實驗 | 黑洞渲染器（掃描顯影）、鏡子（一直維持字元）、爆炸特效、文字 3D；小卡片在終端機打開對應指令 |
| 工作 | 4 個公開專案（連到 GitHub）與 `home.workDocs` 的文件（在終端機打開） |
| 關於 | 第一人稱的兩段話、事實表（相機、鏡頭、程式、語言、合作）、會看人的 ASCII 臉 |
| 鏡子 | 相機 → 字元，在燈箱上即時顯示；快門把這一格印成可複製的文字；按下按鈕前不碰相機 |
| 聯絡 | email（可選取、可複製）、GitHub、狀態列與色溫 |

**兩種光**：暖色（`--sun`）給「拍下來的、和人有關的」：照片、參數、導覽的光點、關於、聯絡；冷色（`--screen`，延續舊版的青綠）給「寫出來的」：工作清單、路徑標籤、終端機。`--sun` 依訪客當地時間變化（白天 5200K 偏白、傍晚 3400K、晚上 2700K、深夜 2200K），頁尾會寫出來；`theme 2700k` 可固定，`theme auto` 回到依時間。

## 指令（按 `~` 打開終端機）

| 指令 | 作用 |
|---|---|
| `help` | 指令清單 |
| `about` `projects` `works` `skills` `contact` | 內容。`project <編號\|名稱>` 看單一專案，`work <編號\|名稱>` 看單一作品；頁面同時捲到對應區塊 |
| `gallery` `photos` `view <編號\|名稱>` | 圖片、影片與照片：縮圖格（點縮圖在檢視器放大，點標題進入該張的頁面）。`view 1` 先用字元畫出圖片（由圖片自己的像素算出），再溶解成真正的圖片 |
| `ls` `cat <檔案>` `open <目標>` | 虛擬檔案系統與開啟連結 |
| `theme [auto\|5200k\|3400k\|2700k\|2200k]` | 頁面光的色溫（`auto` 依當地時間；也可以打 `theme 2700`）。彩蛋：`theme matrix` |
| `lang [en\|zh]` | 語言（預設依瀏覽器語言）；整個頁面用新語言重新顯示 |
| `ascii`（別名 `face`） | ASCII 臉：眼睛跟著游標、會眨眼、你打字時嘴巴會動 |
| `3d [donut\|cube\|sphere]` | 用文字畫的旋轉 3D 模型（有光影與遮擋），游標控制轉動；直接輸入 `cube` 等同 `3d cube` |
| `transition [auto\|dissolve\|scan\|rain\|off]` | 終端機輸出的 ASCII 轉場 |
| `mode [page\|log]` | `page`（預設）：一次顯示一頁；`log`：像傳統終端機，每個指令的輸出都保留、往下捲 |
| `mirror` `mirror off` | 在終端機裡開相機鏡子：會跳出幾乎佔滿視窗的大畫面（頁面最下面的鏡子則留在燈箱裡） |
| `clear` `history` | 清除畫面、歷史指令 |

操作：`~` 開關終端機、`Esc` 關閉、`Tab` 補全、`↑/↓` 歷史、`Ctrl+L` 清除、`Ctrl+C` 取消。網址 `#photos` `#lab` `#work` `#about` `#mirror` `#contact` 會捲到頁面上的區塊；其他終端機認得的網址（`#projects`、`#help`、`#works/black-hole`、`#photos/looking-back`…）會打開終端機並顯示那一頁。色溫、語言、`mode`、`transition` 會存在 `localStorage`。

彩蛋（不在 help 裡）：`neofetch`、`whoami`、`sudo`、`exit`、`date`、`echo`、`theme matrix`。

## 結構

```
index.html            骨架 + 預渲染的英文頁面（沒有 JS 也能讀）+ 終端機抽屜
src/content.js        所有文案（中英）、專案、作品、圖庫、首頁選了哪些圖（`home`）—— 要改內容只改這裡
src/page.js           首頁 -> HTML 字串（純函式；預渲染與切換語言共用）
src/site.js           讓首頁動起來：顯影、手電筒、標題解碼、導覽光點、色溫、ASCII 臉、鏡子的快門與印樣
src/light.js          光與動態的純函式：色溫、曝光數字、字元解碼、顯影階梯（可在 Node 測試）
src/main.js           終端機抽屜、指令執行、語言與色溫、網址，以及把頁面和終端機接起來
src/engine.js         指令引擎：純函式，沒有 DOM，可在 Node 測試
src/render.js         終端機輸出區塊 -> HTML 字串
src/route.js          指令 ↔ 網址 hash ↔ 標題（純函式）
src/lightbox.js       圖片檢視器：原生 <dialog>（焦點陷阱、Esc、焦點回到來源），支援影片，關閉時停止播放
src/viewer-content.js 檢視器的內容：<img>/<video> 的建立、拍攝資訊、停止影片
src/photos.js         攝影：拍攝資訊的白名單與格式化（純函式）
src/guard.js          啟動守門員（普通腳本）：主程式沒啟動時顯示原因
src/fx/imgascii.js    圖片 -> ASCII（純函式：RGBA 像素 -> 字元，含自動對比與透明度處理）
src/fx/mirror.js      相機鏡子（頁面燈箱版與終端機大畫面版共用）
src/fx/face.js        ASCII 臉      src/fx/rain.js  字元表與雜湊（臉與轉場共用）
src/fx/ascii3d.js     ASCII 3D：曲面取樣 + z-buffer + 光影 -> 字元（純函式，可測試）
src/fx/transition.js  ASCII 轉場的純邏輯      src/fx/wipe.js  轉場的 DOM 控制器
assets/gallery/       圖片與影片；`SOURCES.md` 記錄每個檔案的來源與轉檔方式
scripts/              prerender.mjs、serve.mjs、e2e.mjs、add-photo.mjs、make-og.mjs
test/                 node:test 單元測試
```

## 設計與標準

**可及性**
- 沒有 JavaScript、或開啟「減少動態」時，照片與文字直接就在那裡；顯影、解碼、手電筒都只是加上去的。所有 canvas 都是 `aria-hidden`，解碼中的標題最後一定落回原文。
- 單一 `<h1>`（名字），每個區塊有標題；skip link 跳到內容；`:focus-visible` 有清楚的外框。
- 照片是真正的連結（連到原圖檔），沒有 JS 也能點；有 JS 時改開檢視器。需要 JS 的按鈕（快門、複製、色溫、語言）一開始是 `hidden`。
- 終端機：輸出區是 `role="log"`，開機動畫期間 `aria-live="off"`；輸入框是原生 `<input>`，注音等輸入法組字期間不會被快捷鍵干擾；`~` 只在不是打字的時候才會開關抽屜。
- 觸控裝置沒有手電筒；點左下角的指令列打開終端機時不會自動跳出鍵盤。
- 如果主程式在某個瀏覽器沒有啟動，`src/guard.js` 會在 3 秒後顯示說明框與實際錯誤，內容（預渲染）仍可閱讀。

**安全與隱私**
- 嚴格的 CSP（`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'`，部署版沒有 `connect-src`，頁面無法對外發出任何請求）：沒有行內腳本、沒有行內樣式、沒有第三方來源，也**沒有外部字型**（全部用系統字型；標題用系統的襯線字）。
- 使用者輸入（例如 `echo`）一律跳脫；`src/page.js` 產生的所有文字也都跳脫；外部連結帶 `rel="noopener noreferrer"`。
- **相機鏡子**（`src/fx/mirror.js`）：**按下按鈕才會要求相機**（開啟網址不會啟動相機）；只用視訊、不要麥克風；影像在裝置上轉成文字就丟掉。頁面上的鏡子留在燈箱裡（`stage: false`），終端機的 `mirror` 會開大畫面（原生 `<dialog>`，依相機比例放到最大）。
- **鏡子的解析度**：
  - **焦距**：28／50／85mm 三顆按鈕（頁面與大畫面都有）。長焦距裁切畫面中央、稍微偏上（臉通常在那裡），所以臉分到更多字，計算量不變。桌機預設 50mm，手機前鏡頭本來就近，預設 28mm。
  - **字的大小只走固定階梯**（36、48、64、80、100、128、160、200、240 欄），不再隨每次量測連續變化，畫面不會「呼吸」。頁面燈箱最多 100 欄、大畫面 160 欄、真正全螢幕 240 欄；每格至少 6px，再細就不像字、像半色調照片了。
  - **先降解析度，再降幀率**：鏡子最重要的是「我一動它就動」。一格花超過預算的 20%（約 13 毫秒，在幀率需要變慢之前）連續兩次就降一階；下一階預估仍很寬裕、連續五次才升一階。只有降到最低一階還太慢時才降幀率。
  - **快門比即時畫面細**：觀景窗是預覽，按下快門才拍：印樣用即時欄數的 1.5 倍（最多 240 欄）重新算一格。每張即時印樣可以「複製成文字」或「複製 80 欄版」（貼到聊天或終端機不會折行）。Stop／Esc／離開頁面／分頁被隱藏都會立刻關掉相機；重新顯示頁面（換語言）也會。程式碼完全不使用 `MediaRecorder`、`toDataURL`、`toBlob`、`captureStream`、網路請求（`test/mirror.test.mjs` 掃描 `src/` 把關）。快門印出的只是文字，留在頁面上，不會被存起來。
- 頁尾狀態列顯示「0 cookies · 0 trackers · 0 dependencies」與版本號，每一句都有測試把關（`test/status.test.mjs`）。改版本號時要同時改 `package.json`、`src/content.js` 的 `VERSION`（`index.html` 由 `npm run build` 產生）。
- 不做任何分析或追蹤。`localStorage` 的讀寫都包了 try/catch。

**效能**
- 零相依；`modulepreload` 避免模組瀑布。
- 每張圖只在第一次進入畫面時顯影一次，結束就移除 canvas；顯影用的取樣在很小的 canvas 上做（每個字一個像素）。首屏的手電筒只在滑鼠移動時重畫。ASCII 臉只在它出現在畫面上時才動。
- 圖片都有寬高，載入時版面不會跳動。

**SEO / 無 JS**
- `index.html` 內含用 `npm run build` 預渲染的英文頁面；沒有 JavaScript 也能完整閱讀。
- 單一 `<h1>`、meta description、Open Graph、`Person` 的 JSON-LD。

**文案草稿**：這次改版的新文字（`ui[lang].page`：首屏那句話、「最近」兩格、照片與實驗的介紹、實驗卡片上的問題、「關於」的開場句與兩段話、鏡子與聯絡的標題）是依網站原有內容寫的草稿，請改成你自己的話，尤其是「最近」和實驗卡片上的問題。

**內容規則**：只放你自己的公開 repo 與對外定位；不要寫私有專案名稱、客戶、數字或營收。每個主張都應能對應到公開的證據。

**作品（`works`）**：除了 4 個程式專案，另有 6 項作品（視覺與 3D、研究與思考、設計）。每一項都已對照原始資料查證，只用可公開的部分並去識別化（不含私人專案名稱、合作對象、客戶、金額）；每一項都有「不主張」欄位說明沒有宣稱什麼。只有確實有公開頁面的才附連結。新增作品請照 `works` 的欄位格式寫，`test/content.test.mjs` 會擋下私人字眼與術語。

**攝影**：網站上現在有 12 張你自己的照片（Nikon Z 6，2025 年 2 月某一天拍的；圖庫編號 5–16，標題與說明是依照片內容寫的、不含地點與姓名，歡迎自行改寫）。`photos` 指令與首頁的「照片」區塊在沒有任何照片時不會出現（不會有空的區塊，導覽也不會有連結）；首頁要顯示哪幾張照片由 `src/content.js` 的 `home.photos` 決定。要加新照片：

1. `node scripts/add-photo.mjs ~/路徑/照片.jpg`（可一次多張；需要 macOS 的 `sips` 與 ImageMagick）。它會轉成 sRGB、修正旋轉、輸出 1600px 大圖與 480px 縮圖到 `assets/gallery/`，**移除所有中繼資料**（GPS 位置、機身序號、擁有者姓名、內嵌縮圖），從原檔讀出相機與曝光資訊，並印出要貼進 `src/content.js` `gallery` 的條目（`set: 'photo'`、`shot: {…}`）。
2. 你自己填雙語的 `title`、`caption`、`alt`（不要寫你不想公開的地點或人物），並在 `assets/gallery/SOURCES.md` 記下檔案。
3. `npm run check`。

拍攝資訊只會顯示 `camera · lens · focal · aperture · shutter · iso` 這六個欄位（`src/photos.js` 的白名單，其他欄位進不了頁面）。測試會檢查：`assets/` 底下每一張 JPEG 都沒有 Exif／GPS／XMP／IPTC／註解；`add-photo` 對一張刻意塞滿 GPS、序號、姓名的假照片能完整清除並正確讀出相機資訊；有照片時的指令、首頁、檢視器與靜態頁（`test/photos-site.test.mjs`）。

**圖片**：只放你自己的作品或公開專案的輸出，放在 `assets/gallery/`，並在 `SOURCES.md` 記下來源。新增圖片時在 `src/content.js` 的 `gallery` 填寫實際的 `width`／`height`（測試會核對，避免載入時版面跳動）、雙語標題與說明、以及描述圖片內容的 `alt`；說明文字要老實寫出「這張圖不是什麼」。縮圖與轉檔可用 macOS 內建的 `sips`（例如 `sips -s format jpeg -s formatOptions 82 -Z 1024 in.png --out out.jpg`）。每個檔案 < 200 KB（影片 < 600 KB）、總量 < 1.2 MB 由測試把關。影片要把索引放在檔案最前面（`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`，不重新編碼），否則瀏覽器得先抓檔案尾端才能開始播，測試也會擋下。

**白話優先**：網站的讀者包含不寫程式的人。標題、摘要、重點、自介都用白話；工程術語只能放在標示「給工程師」的那一行、技能清單與工具名稱。`test/content.test.mjs` 有一個測試會擋下白話欄位裡的術語。

## 測試

- `test/*.test.mjs`：指令引擎、補全、跳脫、內容完整性（中英同構）、首頁的每個區塊與順序、沒有行內樣式或事件、色溫與曝光數字與字元解碼、CSP 與 SEO 必備項目、預渲染是否同步、鏡子的隱私規則、啟動守門員與樣式規則。
- `scripts/e2e.mjs`：真實 Chrome（DevTools Protocol）。涵蓋首屏顯影與曝光數字、手電筒、照片進入畫面時溶解、導覽光點、檢視器、終端機抽屜（`~`、開機、指令、補全、歷史、捲動同步、Esc）、色溫與語言按鈕、網址（區塊捲動 vs. 打開終端機）、頁面鏡子與快門（Chrome 的假相機）、終端機鏡子大畫面、減少動態、手機版面，並檢查全程沒有 console 錯誤或 CSP 違規。在 Linux 以 root 執行時 Chrome 需要 `--no-sandbox`，可用一個包裝腳本傳給 `CHROME=`。

## 尚未完成（需要你提供資料或決定）

- **Lighthouse**（以下是改版前的數字，改版後還沒重跑；本機 `npx lighthouse@12`，桌面預設，連跑 6 次）：效能 100、無障礙 100、最佳實務 100、SEO 92，CLS 0.01；手機預設（單次）效能 98、CLS 0.05。SEO 少的 8 分是 `robots.txt` 項目：Lighthouse 從頁面內用 `fetch` 抓檔，被我們刻意嚴格的 CSP（沒有 `connect-src`）擋下，`robots.txt` 本身存在且回 200，爬蟲不受影響，所以不為此放寬 CSP。本機開發伺服器沒有壓縮與快取標頭，那幾項（壓縮、`no-store` 造成的 bfcache）要等部署到真正的主機才有意義。這次跑出並修掉的：版面位移（左右分屏在 JS 啟動前先把終端機固定在第 2 欄）、email 按鈕對比不足（瀏覽器預設按鈕底色）、`fx`／語言按鈕的無障礙名稱要包含可見文字。
- **部署**：已上線 https://qwertyboy0325.github.io/personal-site/ （GitHub Pages，從 `main` 分支根目錄發佈；每次 push 到 `main` 會自動重新發佈）。線上版 Lighthouse：效能 97、無障礙 100、最佳實務 100、SEO 92，壓縮與 bfcache 項目已通過。任何靜態主機都可以（GitHub Pages、Cloudflare Pages…）。所有路徑都是相對的，可放在子路徑。部署前先跑 `npm run check`。

## 授權、網址與分享預覽

- **授權**：程式碼、測試、腳本與文件採 **MIT**（`LICENSE`，著作權人 Ezra Wu）。**照片與其他圖片、影片不在 MIT 範圍內**（保留所有權利，見 `assets/NOTICE.md`），因為照片裡有人；若你想把圖片也開放，改 `assets/NOTICE.md` 與這一節即可。
- **網址**：唯一的來源是 `src/content.js` 的 `SITE_URL`；`index.html` 的 canonical、`og:url`、`og:image`、`twitter:image`、JSON-LD，以及 `sitemap.xml`、`robots.txt` 都要一致（`test/share.test.mjs` 會檢查）。換網域時：改 `SITE_URL`、同步更新上述檔案、執行 `node scripts/make-og.mjs`。
- **分享預覽圖**：`assets/og.png`（1200×630，約 60 KB）由 `node scripts/make-og.mjs` 用 headless Chrome 畫出，文字取自 `src/content.js`（姓名、職稱、橫幅、一句話介紹），所以不會與網站內容脫節；測試會檢查尺寸、大小與每個 meta 標籤。
- `sitemap.xml` 只有首頁一個網址（單頁網站）；更新內容後把 `lastmod` 改成當天日期。

## 備註

- `src/fx/` 內的字元雨、網路圖與 ASCII 臉由另一個 agent 撰寫後併入；ASCII 3D、轉場、準星、左右分屏概覽、啟動守門員與 matrix 主題是之後加上的。
- 人臉維持 ASCII 風格（曾做過一版 SVG 臉，已依需求移除）。
- 改版（光的主題）拿掉了左右分屏概覽、dock、即時遙測、背景字元雨與網路圖、準星游標、可拖曳的浮動檢視視窗、macOS 視窗外框，以及 `fx`、`cursor`、`hud` 指令；`theme` 從四個配色改成色溫。分享預覽圖 `assets/og.png` 還是舊版的終端機卡片，要換的話改 `scripts/make-og.mjs` 再重新產生。
