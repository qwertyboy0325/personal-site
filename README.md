# personal-site

終端機風格的單頁互動個人網站。純 HTML / CSS / JavaScript：沒有框架、沒有第三方資源、應用本身不需要 build。

在終端機裡輸入指令瀏覽內容，外圍是駭客風 HUD：即時遙測、可點擊的專案地圖、準星游標、ASCII 轉場與背景特效。

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
- 熱重載的腳本與放寬的 CSP（`connect-src 'self'`）只在伺服器回應時注入，磁碟上的 `index.html` 與部署的內容不受影響。`LIVERELOAD=0 npm run dev` 可關閉。
- 存檔後頁面沒反應時，先看執行 `npm run dev` 的終端機有沒有印出 `reload` 或 `css` 的訊息；沒有的話代表該檔案屬於被忽略的類型。

## 指令

| 指令 | 作用 |
|---|---|
| `help` | 指令清單 |
| `about` `projects` `works` `skills` `contact` | 內容。`project <編號\|名稱>` 看單一專案，`work <編號\|名稱>` 看單一作品 |
| `ls` `cat <檔案>` `open <目標>` | 虛擬檔案系統與開啟連結 |
| `theme [dark\|light\|amber\|matrix]` | 色彩主題 |
| `lang [en\|zh]` | 語言（預設依瀏覽器語言） |
| `ascii`（別名 `face`） | ASCII 臉：眼睛跟著游標、會眨眼、你打字時嘴巴會動 |
| `3d [donut\|cube\|sphere]` | 用文字畫的旋轉 3D 模型（有光影與遮擋），游標控制轉動；直接輸入 `cube` 等同 `3d cube` |
| `fx [both\|rain\|network\|off]` | 背景特效 |
| `transition [auto\|dissolve\|scan\|rain\|off]` | ASCII 轉場 |
| `cursor [full\|minimal\|off]` | 準星游標；預設 `minimal`（小圓環＋會淡出的座標），`full` 才有滿版十字線 |
| `hud [on\|off]` | 側邊 HUD 面板（螢幕寬度 1320px 以上） |
| `clear` `history` | 清除畫面、歷史指令 |

操作：`Tab` 補全、`↑/↓` 歷史、`Ctrl+L` 清除、`Ctrl+C` 取消、網址 `#about` `#projects` `#skills` `#contact` `#help` 可直接連到內容。選擇（主題、語言、特效、游標、HUD）會存在 `localStorage`。

彩蛋（不在 help 裡）：`neofetch`、`whoami`、`sudo`、`exit`、`date`、`echo`。

## 結構

```
index.html            骨架 + 預渲染的英文內容（沒有 JS 也能讀）
src/content.js        所有文案（中英）、專案、技能 —— 要改內容只改這裡
src/engine.js         指令引擎：純函式，沒有 DOM，可在 Node 測試
src/render.js         區塊 -> HTML 字串，唯一的渲染器（瀏覽器與預渲染共用）
src/main.js           DOM、鍵盤、主題、語言、開機、各效果的接線
src/hud.js            HUD 面板（遙測、專案地圖、最近指令）
src/hud-format.js     HUD 用的純格式化函式
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
- 所有動畫特效（雨、網路、轉場、準星、HUD 左欄）都是 `aria-hidden`；轉場只在新輸出上疊一層 canvas，**不改動 DOM 文字**，所以螢幕閱讀器、選取與複製不受影響。
- 輸入框使用原生 `<input>`，注音等輸入法組字期間不會被快捷鍵干擾。
- 有 skip link、`:focus-visible`、可由鍵盤操作的 HUD 專案地圖。
- 三個以上主題的所有文字顏色對比都 ≥ 4.5:1（`npm run e2e` 逐一量測）。
- `prefers-reduced-motion`：不啟動轉場、背景動畫、準星波紋與眼睛追蹤。
- 觸控裝置不顯示準星。HUD 只依螢幕寬度顯示（≥ 1320px，所以橫放的大型平板也會出現），其中的按鈕高度 ≥ 24px（WCAG 2.2 最低標準）。
- 快捷指令按鈕高度 44px；右上角工具列按鈕高 36px、寬 44px。

**安全與隱私**
- 嚴格的 CSP（`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'`）：沒有行內腳本、沒有行內樣式、沒有第三方來源。
- 使用者輸入（例如 `echo`）一律跳脫；只有 `https://` 連結會被渲染成 `<a>`，且帶 `rel="noopener noreferrer"`。
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

**白話優先**：網站的讀者包含不寫程式的人。標題、摘要、重點、自介都用白話；工程術語只能放在標示「給工程師」的那一行、技能清單與工具名稱。`test/content.test.mjs` 有一個測試會擋下白話欄位裡的術語。

## 測試

- `test/*.test.mjs`：指令引擎、補全、跳脫、內容完整性（中英同構）、CSP 與 SEO 必備項目、預渲染是否同步、臉的決定性與座標範圍、轉場數學、準星、HUD 格式化與樣式規則。
- `scripts/e2e.mjs`：真實 Chrome（DevTools Protocol）。涵蓋鍵盤操作、主題循環、語言切換、轉場、準星、HUD 版面與互動、對比度、手機版面、無 JS、減少動態、觸控模擬，並檢查全程沒有 console 錯誤或 CSP 違規。

## 尚未完成（需要你提供資料或決定）

- **email**：`src/content.js` 的 `profile.email` 目前是 `null`，所以 `contact` 只顯示 GitHub。
- **分享預覽圖**（`og:image`）與 **網域 / canonical 網址**：還沒有，所以 `index.html` 沒有 `og:image`、`og:url`、`canonical`，也沒有 `sitemap.xml`。
- **授權條款**：尚未選擇。
- **Lighthouse**：尚未跑。目前的可及性與效能數據來自上面的自訂測試，不是 Lighthouse 分數。
- **部署**：任何靜態主機都可以（GitHub Pages、Cloudflare Pages…）。所有路徑都是相對的，可放在子路徑。部署前先跑 `npm run check`。

## 備註

- `src/fx/` 內的字元雨、網路圖與 ASCII 臉由另一個 agent 撰寫後併入；ASCII 3D、轉場、準星、HUD 與 matrix 主題是之後加上的。
- 人臉維持 ASCII 風格（曾做過一版 SVG 臉，已依需求移除）。
