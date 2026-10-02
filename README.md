# personal-site

終端機風格的單頁互動個人網站。純 HTML / CSS / JavaScript：沒有框架、沒有第三方資源、應用本身不需要 build。

左右分屏：左邊是 GUI 概覽（名片、專案與作品卡片、技能、即時遙測），右邊是終端機。點卡片會在終端機執行對應指令，在終端機輸入指令也會讓對應的卡片亮起。另有準星游標、ASCII 轉場、ASCII 3D 與背景特效。

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
- 改 `src/content.js`、`engine.js`、`render.js`、`fx/face.js`、`fx/rain.js` 時，終端機會提醒你跑 `npm run build`，因為這些會影響 `index.html` 內預渲染的無 JS 內容（伺服器不會替你改寫檔案）。
- 開發伺服器支援 HTTP Range（分段傳輸）：**Safari 沒有它就不會播放 `<video>`**。
- 熱重載的腳本與放寬的 CSP（`connect-src 'self'`）只在伺服器回應時注入，磁碟上的 `index.html` 與部署的內容不受影響。`LIVERELOAD=0 npm run dev` 可關閉。
- 存檔後頁面沒反應時，先看執行 `npm run dev` 的終端機有沒有印出 `reload` 或 `css` 的訊息；沒有的話代表該檔案屬於被忽略的類型。

## 指令

| 指令 | 作用 |
|---|---|
| `help` | 指令清單 |
| `about` `projects` `works` `skills` `contact` | 內容。`project <編號\|名稱>` 看單一專案，`work <編號\|名稱>` 看單一作品 |
| `gallery` `photos` `view <編號\|名稱>` | 圖片、影片與照片：`gallery`／`photos` 是一整面**縮圖格**（點縮圖在檢視器放大，點底下的標題進入該張的頁面）。`view 1` 會先把圖片用字元畫出來（由圖片自己的像素算出），再「溶解」成真正的圖片；點圖片開檢視器（←/→ 切換、Esc 關閉）：寬螢幕＋滑鼠時是**可拖曳的浮動視窗**（可同時開多個，點擊置前，標題列顯示檔名與尺寸，Alt+方向鍵可用鍵盤移動），窄螢幕與觸控則是全頁對話框。左側概覽也有縮圖卡片 |
| `ls` `cat <檔案>` `open <目標>` | 虛擬檔案系統與開啟連結 |
| `theme [dark\|light\|amber\|matrix]` | 色彩主題 |
| `lang [en\|zh]` | 語言（預設依瀏覽器語言） |
| `ascii`（別名 `face`） | ASCII 臉：眼睛跟著游標、會眨眼、你打字時嘴巴會動 |
| `3d [donut\|cube\|sphere]` | 用文字畫的旋轉 3D 模型（有光影與遮擋），游標控制轉動；直接輸入 `cube` 等同 `3d cube` |
| `fx [both\|rain\|network\|off]` | 背景特效 |
| `transition [auto\|dissolve\|scan\|rain\|off]` | ASCII 轉場 |
| `cursor [full\|minimal\|off]` | 準星游標；預設 `minimal`（小圓環＋會淡出的座標），`full` 才有滿版十字線 |
| `mode [page\|log]` | `page`（預設）：右側像文件一樣**一次顯示一頁**，新的一頁取代上一頁；`log`：像傳統終端機，每個指令的輸出都保留、往下捲 |
| `hud [on\|off]`（別名 `gui`） | 左側概覽。≥ 1000px 與終端機左右並排；較窄時改用上方「概覽｜終端機」分頁 |
| `clear` `history` | 清除畫面、歷史指令 |

操作：`Tab` 補全、`↑/↓` 歷史、`Ctrl+L` 清除、`Ctrl+C` 取消、網址 `#about` `#projects` `#skills` `#contact` `#help` 可直接連到內容。選擇（主題、語言、特效、游標、概覽）會存在 `localStorage`。

彩蛋（不在 help 裡）：`neofetch`、`whoami`、`sudo`、`exit`、`date`、`echo`。

## 結構

```
index.html            骨架 + 預渲染的英文內容（沒有 JS 也能讀）
src/content.js        所有文案（中英）、專案、技能 —— 要改內容只改這裡
src/engine.js         指令引擎：純函式，沒有 DOM，可在 Node 測試
src/render.js         區塊 -> HTML 字串，唯一的渲染器（瀏覽器與預渲染共用）
src/main.js           DOM、鍵盤、主題、語言、開機、各效果的接線
src/lightbox.js       圖片檢視器（窄螢幕／觸控）：原生 <dialog>（焦點陷阱、Esc、焦點回到來源），支援影片，關閉時停止播放
src/windows.js        圖片檢視器（寬螢幕＋滑鼠）：可拖曳、可堆疊的浮動視窗（最多 6 個、拖曳限制在畫面內、非 modal，終端機照常可用）
src/photos.js         攝影：拍攝資訊的白名單與格式化（純函式）
src/route.js          每個「頁面」的位置：指令 ↔ 網址 hash ↔ 麵包屑 ↔ 標題（純函式）
src/dock.js           寬螢幕＋滑鼠的 dock 導覽：七個主要指令、游標附近的圖示放大、目前區段的圓點（純函式 + 小控制器）
src/viewer-content.js 兩種檢視器共用：檔名／尺寸、<img>/<video> 的建立、停止影片
src/fx/imgascii.js    圖片 -> ASCII（純函式：RGBA 像素 -> 字元，含自動對比與透明度處理）
assets/gallery/       圖片與影片；`SOURCES.md` 記錄每個檔案的來源與轉檔方式
src/gui.js            左側概覽：由 content.js 產生專案/作品/技能卡片，與終端機雙向連動（純函式 + 小控制器）
src/hud.js            概覽底部的即時遙測與最近指令（只在面板實際顯示時才運作）
src/hud-format.js     遙測用的純格式化函式
src/guard.js          啟動守門員（普通腳本）：主程式沒啟動時顯示原因，而不是一個沒反應的頁面
src/fx/rain.js        字元雨           src/fx/network.js   點線網路
src/fx/fx.js          背景 canvas      src/fx/face.js      ASCII 臉
src/fx/ascii3d.js     ASCII 3D：曲面取樣 + z-buffer + 光影 -> 字元（純函式，可測試）
src/fx/transition.js  ASCII 轉場的純邏輯（儲存格狀態 + 繪製）
src/fx/wipe.js        轉場的 DOM 控制器（單一輸出消散 / 整頁 wipe）
src/fx/reticle.js     準星游標與座標標籤
assets/               游標用 SVG
scripts/              prerender.mjs、serve.mjs、e2e.mjs
test/                 node:test 單元測試
```

## 設計與標準

**可及性**
- 輸出區是 `role="log"`；開機動畫期間 `aria-live="off"`，結束後才設為 `polite`。
- 所有動畫特效（雨、網路、轉場、準星、遙測面板）都是 `aria-hidden`；轉場只在新輸出上疊一層 canvas，**不改動 DOM 文字**，所以螢幕閱讀器、選取與複製不受影響。
- 輸入框使用原生 `<input>`，注音等輸入法組字期間不會被快捷鍵干擾。
- 有 skip link、`:focus-visible`；概覽卡片是真正的 `<button>`，可用鍵盤操作；分頁用 `aria-pressed`。
- 如果主程式在某個瀏覽器沒有啟動，`src/guard.js` 會在 3 秒後顯示說明框與實際錯誤，內容（預渲染）仍可閱讀。
- 三個以上主題的所有文字顏色對比都 ≥ 4.5:1（`npm run e2e` 逐一量測）。
- `prefers-reduced-motion`：不啟動轉場、背景動畫、準星波紋與眼睛追蹤。
- 觸控裝置不顯示準星。概覽依螢幕寬度顯示（≥ 1000px 並排，較窄用分頁，所以平板與手機也能用），卡片與分頁高度 ≥ 44px，遙測中的最近指令按鈕 ≥ 24px（WCAG 2.2 最低標準）。
- 快捷指令按鈕高度 44px；右上角工具列按鈕高 36px、寬 44px。

**安全與隱私**
- 嚴格的 CSP（`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'`，部署版沒有 `connect-src`，頁面無法對外發出任何請求）：沒有行內腳本、沒有行內樣式、沒有第三方來源。
- 使用者輸入（例如 `echo`）一律跳脫；只有 `https://` 連結會被渲染成 `<a>`，且帶 `rel="noopener noreferrer"`。
- 排版：終端機與細節用等寬字；只有大名字與標題用系統無襯線字（`--display`），名字用 `clamp()` 流體縮放（手機 40px → 寬螢幕 68px），320px 也不會溢出；e2e 逐寬度驗證。
- **圖片轉場（字元 → 真圖）**：字元畫面不必等整張照片下載。頁面載入完成、瀏覽器閒下來時，會先把畫面上已有的縮圖換算好（依畫面寬度決定欄數、約每 7px 一個字，並記住結果）；打開一張圖時，若已算好就直接顯示，否則用已在快取的原圖或縮圖現算。縮圖與原圖算出的字元有 92–96% 完全相同、其餘只差一個層級（實測 16 張），所以不影響品質。完整照片到了才溶解，沒到之前字元一直留著。測試涵蓋：對齊（字元寬高與圖片誤差 < 1.5%）、慢網路（完整照片延遲 2.5 秒）、預先算好（全部圖片請求都被卡住時仍立即顯示）。
- **閱讀窗格**：右側預設一次顯示一頁（`mode page`）。頂端的位置列有「上一頁／下一頁」與麵包屑（`~ / projects / vox-proof`，前面的部分可點）。每一頁都有自己的網址：`#projects/<名稱>`、`#works/<名稱>`、`#gallery/<名稱>`、`#photos/<名稱>`，另有 `#about`、`#projects`、`#works`、`#gallery`、`#photos`、`#skills`、`#contact`、`#help`（舊的 `#works` 之類連結照常可用）；瀏覽器的上一頁／下一頁、手動改網址、分享連結都能回到同一頁，分頁標題也跟著變。切換語言會用新語言重新顯示目前這一頁。`theme`、`lang` 這類「動作」指令的輸出會加在頁面下方，不會取代頁面；`clear` 清空窗格並回到 `~`。對應的純函式在 `src/route.js`（`test/route.test.mjs`），e2e 在「reader pane」與「contact sheets」兩段。注意：`#` 後面的網址搜尋引擎不會各自收錄，`sitemap.xml` 因此只有首頁。
- Dock 導覽（寬螢幕＋滑鼠）：浮在畫面底部中央，取代快速指令按鈕；滑鼠靠近時圖示放大（只用 transform，不會讓版面位移），鍵盤聚焦也會放大，減少動態時不放大；窄螢幕與觸控維持原本的按鈕。終端機與概覽會自動讓出 dock 的高度（`--dock-h`），「已複製」提示也在 dock 上方。
- 狀態列（終端機視窗底部）顯示版本號與「0 cookies · 0 trackers · 0 dependencies」，每一句都有測試把關（`test/status.test.mjs`）：`package.json` 沒有任何 dependencies、`src/` 只有相對路徑的 import、程式碼不碰 cookie、沒有任何網路請求且 CSP 不允許外部主機。改版本號時要同時改 `package.json`、`src/content.js` 的 `VERSION` 與 `index.html`（測試會提醒）。
- 不使用外部字型、不做任何分析或追蹤。`localStorage` 的讀寫都包了 try/catch。

**效能**
- 約 119 KB 原始碼（壓縮後約 38 KB），零相依；`modulepreload` 避免模組瀑布。
- 背景 canvas 在分頁隱藏時暫停、限制 devicePixelRatio、畫格變慢時自動降低密度；`saveData` 時預設關閉特效與轉場。
- 準星用 `transform`；原生游標換成 SVG 準星，所以游標本身零延遲，只有裝飾層會緩動。

**SEO / 無 JS**
- `index.html` 內含用 `npm run build` 預渲染的英文內容；沒有 JavaScript 也能完整閱讀，且不會出現失效的按鈕。
- 單一 `<h1>`、meta description、Open Graph、`Person` 的 JSON-LD。

**內容規則**：只放你自己的公開 repo 與對外定位；不要寫私有專案名稱、客戶、數字或營收。每個主張都應能對應到公開的證據。

**作品（`works`）**：除了 4 個程式專案，另有 6 項作品（視覺與 3D、研究與思考、設計）。每一項都已對照原始資料查證，只用可公開的部分並去識別化（不含私人專案名稱、合作對象、客戶、金額）；每一項都有「不主張」欄位說明沒有宣稱什麼。只有確實有公開頁面的才附連結。新增作品請照 `works` 的欄位格式寫，`test/content.test.mjs` 會擋下私人字眼與術語。

**攝影**：網站上現在有 12 張你自己的照片（Nikon Z 6，2025 年 2 月某一天拍的；圖庫編號 5–16，標題與說明是依照片內容寫的、不含地點與姓名，歡迎自行改寫）。`photos` 指令與概覽的「攝影」區塊在沒有任何照片時不會出現（不會有空的區塊）。要加新照片：

1. `node scripts/add-photo.mjs ~/路徑/照片.jpg`（可一次多張；需要 macOS 的 `sips` 與 ImageMagick）。它會轉成 sRGB、修正旋轉、輸出 1600px 大圖與 480px 縮圖到 `assets/gallery/`，**移除所有中繼資料**（GPS 位置、機身序號、擁有者姓名、內嵌縮圖），從原檔讀出相機與曝光資訊，並印出要貼進 `src/content.js` `gallery` 的條目（`set: 'photo'`、`shot: {…}`）。
2. 你自己填雙語的 `title`、`caption`、`alt`（不要寫你不想公開的地點或人物），並在 `assets/gallery/SOURCES.md` 記下檔案。
3. `npm run check`。

拍攝資訊只會顯示 `camera · lens · focal · aperture · shutter · iso` 這六個欄位（`src/photos.js` 的白名單，其他欄位進不了頁面）。測試會檢查：`assets/` 底下每一張 JPEG 都沒有 Exif／GPS／XMP／IPTC／註解；`add-photo` 對一張刻意塞滿 GPS、序號、姓名的假照片能完整清除並正確讀出相機資訊；有照片時的指令、概覽、檢視器與靜態頁（`test/photos-site.test.mjs`、e2e 的 photography 段落，後者用一份含兩張照片的網站副本在真實瀏覽器中驗證）。

**圖片**：只放你自己的作品或公開專案的輸出，放在 `assets/gallery/`，並在 `SOURCES.md` 記下來源。新增圖片時在 `src/content.js` 的 `gallery` 填寫實際的 `width`／`height`（測試會核對，避免載入時版面跳動）、雙語標題與說明、以及描述圖片內容的 `alt`；說明文字要老實寫出「這張圖不是什麼」。縮圖與轉檔可用 macOS 內建的 `sips`（例如 `sips -s format jpeg -s formatOptions 82 -Z 1024 in.png --out out.jpg`）。每個檔案 < 200 KB（影片 < 600 KB）、總量 < 1.2 MB 由測試把關。影片要把索引放在檔案最前面（`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`，不重新編碼），否則瀏覽器得先抓檔案尾端才能開始播，測試也會擋下。

**白話優先**：網站的讀者包含不寫程式的人。標題、摘要、重點、自介都用白話；工程術語只能放在標示「給工程師」的那一行、技能清單與工具名稱。`test/content.test.mjs` 有一個測試會擋下白話欄位裡的術語。

## 測試

- `test/*.test.mjs`：指令引擎、補全、跳脫、內容完整性（中英同構）、CSP 與 SEO 必備項目、預渲染是否同步、臉的決定性與座標範圍、轉場數學、準星、概覽卡片（含雙向連動的對應規則）、遙測格式化、啟動守門員與樣式規則。
- `scripts/e2e.mjs`：真實 Chrome（DevTools Protocol）。涵蓋鍵盤操作、主題循環、語言切換、轉場、準星、分屏版面與卡片連動、窄螢幕分頁、對比度、手機版面、無 JS、減少動態、觸控模擬、故意弄壞的網站（驗證啟動說明框），並檢查全程沒有 console 錯誤或 CSP 違規。

## 尚未完成（需要你提供資料或決定）

- **Lighthouse**（本機 `npx lighthouse@12`，桌面預設，連跑 6 次）：效能 100、無障礙 100、最佳實務 100、SEO 92，CLS 0.01；手機預設（單次）效能 98、CLS 0.05。SEO 少的 8 分是 `robots.txt` 項目：Lighthouse 從頁面內用 `fetch` 抓檔，被我們刻意嚴格的 CSP（沒有 `connect-src`）擋下，`robots.txt` 本身存在且回 200，爬蟲不受影響，所以不為此放寬 CSP。本機開發伺服器沒有壓縮與快取標頭，那幾項（壓縮、`no-store` 造成的 bfcache）要等部署到真正的主機才有意義。這次跑出並修掉的：版面位移（左右分屏在 JS 啟動前先把終端機固定在第 2 欄）、email 按鈕對比不足（瀏覽器預設按鈕底色）、`fx`／語言按鈕的無障礙名稱要包含可見文字。
- **部署**：已上線 https://qwertyboy0325.github.io/personal-site/ （GitHub Pages，從 `main` 分支根目錄發佈；每次 push 到 `main` 會自動重新發佈）。線上版 Lighthouse：效能 97、無障礙 100、最佳實務 100、SEO 92，壓縮與 bfcache 項目已通過。任何靜態主機都可以（GitHub Pages、Cloudflare Pages…）。所有路徑都是相對的，可放在子路徑。部署前先跑 `npm run check`。

## 授權、網址與分享預覽

- **授權**：程式碼、測試、腳本與文件採 **MIT**（`LICENSE`，著作權人 Ezra Wu）。**照片與其他圖片、影片不在 MIT 範圍內**（保留所有權利，見 `assets/NOTICE.md`），因為照片裡有人；若你想把圖片也開放，改 `assets/NOTICE.md` 與這一節即可。
- **網址**：唯一的來源是 `src/content.js` 的 `SITE_URL`；`index.html` 的 canonical、`og:url`、`og:image`、`twitter:image`、JSON-LD，以及 `sitemap.xml`、`robots.txt` 都要一致（`test/share.test.mjs` 會檢查）。換網域時：改 `SITE_URL`、同步更新上述檔案、執行 `node scripts/make-og.mjs`。
- **分享預覽圖**：`assets/og.png`（1200×630，約 60 KB）由 `node scripts/make-og.mjs` 用 headless Chrome 畫出，文字取自 `src/content.js`（姓名、職稱、橫幅、一句話介紹），所以不會與網站內容脫節；測試會檢查尺寸、大小與每個 meta 標籤。
- `sitemap.xml` 只有首頁一個網址（單頁網站）；更新內容後把 `lastmod` 改成當天日期。

## 備註

- `src/fx/` 內的字元雨、網路圖與 ASCII 臉由另一個 agent 撰寫後併入；ASCII 3D、轉場、準星、左右分屏概覽、啟動守門員與 matrix 主題是之後加上的。
- 人臉維持 ASCII 風格（曾做過一版 SVG 臉，已依需求移除）。
