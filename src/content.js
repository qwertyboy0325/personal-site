// All site copy lives here. Everything is public-safe: it is drawn from the
// owner's public GitHub repos and outward-facing positioning only.
// Do not add private project names, client names, numbers, or revenue claims.

export const profile = {
  name: 'Ezra Wu',
  user: 'ezra',
  host: 'site',
  github: 'https://github.com/qwertyboy0325',
  email: null, // set to a string to show an email line in `contact`
};

export const THEMES = ['dark', 'light', 'amber', 'matrix'];
export const LANGS = ['en', 'zh'];
export const LANG_NAMES = { en: 'English', zh: '繁體中文' };

// 5-row pixel font used for the banner (kept as data so it is easy to change).
const GLYPHS = {
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  Z: ['█████', '   █ ', '  █  ', ' █   ', '█████'],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
};
export const banner = Array.from({ length: 5 }, (_, row) =>
  [...'EZRA'].map((ch) => GLYPHS[ch][row]).join('  ').trimEnd(),
).join('\n');

// Public repositories only. Plain language first (for people who do not write
// code), engineering terms in `tech`. `points` and `nongoals` follow each repo's
// own README / ADRs; keep claims bounded to what those documents state.
export const projects = [
  {
    slug: 'handoff-semantics',
    short: 'handoff', // label on the HUD project map
    url: 'https://github.com/qwertyboy0325/handoff-semantics',
    stack: 'C# · .NET 8 · PostgreSQL',
    en: {
      tag: 'Making sure messages between systems are never lost',
      summary:
        'A worked example of a common business problem: a system saves something (say, an order), but the message that tells other systems about it gets lost or is sent twice. It shows how to design this so a saved change is never silently dropped and a repeated message does not cause a repeated effect.',
      tech: 'Reference implementation of transactional outbox, idempotent inbox, SKIP LOCKED multi-worker safety and dead-letter reprocessing, plus a deterministic stale-failure write-race case study.',
      points: [
        'Spells out, step by step, what is guaranteed at each hand-off and what is not.',
        'Automated tests against a real database; one real timing bug is shown failing, then fixed.',
      ],
      nongoals: 'Not a ready-made product or framework, and it does not promise perfect delivery in every situation.',
    },
    zh: {
      tag: '確保系統之間的訊息不會遺失',
      summary:
        '示範一個常見的商業問題：系統把資料存好了（例如一筆訂單），但通知其他系統的訊息卻遺失，或被送了兩次。它說明該怎麼設計，讓已存好的變更不會被默默漏掉，重複收到的訊息也不會造成重複的結果。',
      tech: '參考實作：transactional outbox、idempotent inbox、SKIP LOCKED 多 worker 安全、dead-letter 重新處理，以及可重現的 stale failure write-race 案例。',
      points: [
        '逐一說明每個交接點保證了什麼、沒有保證什麼。',
        '以真實資料庫做自動化測試；一個真實的時序錯誤先被重現（失敗），再被修好。',
      ],
      nongoals: '不是現成的產品或框架，也不保證任何情況下都能完美送達。',
    },
  },
  {
    slug: 'vox-proof',
    short: 'vox', // label on the HUD project map
    url: 'https://github.com/qwertyboy0325/vox-proof',
    stack: 'Rust',
    en: {
      tag: 'A second pair of eyes for subtitles and transcripts',
      summary:
        'Speech-to-text tools make mistakes, especially with mixed Chinese and English, names and abbreviations. This tool reads an existing subtitle file, highlights the places most likely to be wrong, and suggests fixes together with its reasons. A person always makes the final call, and it runs on your own computer.',
      tech: 'Local-first transcript QA in Rust: reviews an existing SRT (optionally with audio), surfaces high-risk spans, and proposes bounded, evidence-backed corrections for human review.',
      points: [
        'It never rewrites text on its own; the human decision is final.',
        'Every suggestion comes with evidence, and every decision is logged.',
      ],
      nongoals: 'It does not do speech recognition itself, does not auto-correct, and has not yet been validated by outside users.',
    },
    zh: {
      tag: '替字幕與逐字稿多一雙眼睛',
      summary:
        '語音轉文字工具常出錯，尤其是中英夾雜、人名和縮寫。這個工具會讀取現有的字幕檔，標出最可能有錯的地方，並附上理由提出修正建議。最後一律由人決定，而且在你自己的電腦上執行。',
      tech: '以 Rust 打造、本機優先的逐字稿 QA：審閱既有的 SRT（可搭配音訊），標出高風險片段，並提出有邊界、有證據的修正建議，交由人工審核。',
      points: [
        '它不會自己改寫文字，人的決定才是最終結果。',
        '每個建議都附上證據，每個決定都有紀錄。',
      ],
      nongoals: '它本身不做語音辨識、不自動修正，也尚未經過外部使用者的驗證。',
    },
  },
  {
    slug: 'echlub',
    short: 'echlub', // label on the HUD project map
    url: 'https://github.com/qwertyboy0325/echlub',
    stack: 'Rust · WASM · TypeScript',
    en: {
      tag: 'The groundwork for making music together online',
      summary:
        'Groundwork for an online tool where people make music together. The effort goes into getting the core rules right first, keeping the part that decides what is true separate from the part that draws it on screen, and measuring real performance before promising anything about speed or delay.',
      tech: 'Clean rewrite of a collaborative-music foundation: a Rust canonical kernel with TypeScript for presentation only (ADR-0002), a transport-independent protocol (ADR-0004), and intent-aware replication with no silent merge (ADR-0005).',
      points: [
        'Key design choices are written down as decision records.',
        'When two people edit at once, conflicts are surfaced openly rather than silently merged.',
      ],
      nongoals: 'Not a finished music app, and it makes no claim of being faster or lag-free.',
    },
    zh: {
      tag: '一起線上做音樂的基礎工程',
      summary:
        '為「多人一起線上做音樂」的工具打基礎。重點是先把核心規則做對：負責判定「什麼才是真的」的部分，和負責畫在螢幕上的部分分開；在承諾速度或延遲之前，先量測真實的效能。',
      tech: '重寫協作音樂系統的基礎：Rust 為權威核心、TypeScript 只負責呈現（ADR-0002）、與傳輸層無關的協定（ADR-0004），以及以意圖為基礎、不做無聲合併的複寫（ADR-0005）。',
      points: [
        '重要的設計決定都寫成決策紀錄。',
        '兩個人同時編輯時，衝突會被明確標示出來，而不是默默合併。',
      ],
      nongoals: '不是完成的音樂應用程式，也不宣稱更快或沒有延遲。',
    },
  },
  {
    slug: 'echlub-demo',
    short: 'demo', // label on the HUD project map
    url: 'https://github.com/qwertyboy0325/echlub-demo',
    stack: 'TypeScript · Tone.js · GSAP',
    en: {
      tag: 'A clickable demo of the music tool idea',
      summary:
        'An interactive demo that shows how the experience of the music tool could feel, built with web audio and animation libraries.',
      tech: 'Built on Tone.js and GSAP, with the audio clock, the script and the animation kept as separate concerns.',
      points: ['Shows the look and feel in your browser.'],
      nongoals: 'A demonstration of the experience only; it is not evidence that the underlying system works.',
    },
    zh: {
      tag: '音樂工具構想的互動展示',
      summary: '互動式展示，呈現這個音樂工具使用起來可能的感覺，以網頁音訊與動畫函式庫製作。',
      tech: '以 Tone.js 與 GSAP 製作，音訊時鐘、腳本與動畫分屬不同關注點。',
      points: ['在瀏覽器裡就能看到操作的質感。'],
      nongoals: '只是體驗的展示，並不是底層系統可運作的證據。',
    },
  },
];

// Other work worth showing. Only public-safe material, written for people who do
// not write code, and de-identified: no private project names, clients, partners
// or numbers. Each item was checked against its source; `nongoals` states what
// is NOT claimed. `url` is set only when a public page exists.
export const works = [
  {
    slug: 'black-hole',
    kind: 'visual',
    url: 'https://github.com/qwertyboy0325/blackhole-rust',
    en: {
      title: 'Black hole renderer',
      tag: 'Drawing how a black hole bends light',
      summary:
        'A program that draws what the space around a black hole looks like. It works out the path of light rays from physics equations, so the glowing ring and the bent starlight come from calculation rather than from painting. The look is inspired by the film Interstellar.',
      tech: 'Offline Rust renderer: Kerr-spacetime geodesic ray tracing (DOP853 integration), physical thin-disk emission and CIE colorimetry, built in reviewed stages ("gates") with written reports.',
      points: [
        'Built in stages: each stage has a written report and has to pass its checks before the next one begins.',
        'An animated before-and-after of every stage is kept in the project.',
      ],
      nongoals: "Not a copy of the film's own software, and not real-time yet (no graphics-card or interactive viewer).",
    },
    zh: {
      title: '黑洞光線渲染器',
      tag: '畫出黑洞如何彎曲光線',
      summary:
        '一個畫出黑洞周圍景象的程式。它用物理公式算出光線的行進路徑，所以發亮的光環和被彎曲的星光是「算」出來的，不是畫出來的。外觀靈感來自電影《星際效應》。',
      tech: '離線 Rust 渲染器：Kerr 時空的測地線光線追蹤（DOP853 積分）、物理薄盤輻射與 CIE 色度學，以分階段（gate）審查並附書面報告的方式開發。',
      points: [
        '分階段開發：每個階段都有書面報告，通過檢查後才進入下一階段。',
        '每個階段的前後對照動畫都保存在專案裡。',
      ],
      nongoals: '不是電影原本軟體的複製品，目前也還不是即時運算（尚無顯示卡加速或互動檢視器）。',
    },
  },
  {
    slug: 'explosion-fx',
    kind: 'visual',
    en: {
      title: 'Explosion effects studies',
      tag: 'Studying how to make explosion effects look convincing',
      summary:
        'A game-engine prototype used as a testbed for cinematic explosion effects: the shape of the fireball, the shock ring, drifting dust, and lighting on a real city district rebuilt from open map data. It is set in a fictional sandbox with made-up parameters.',
      tech: 'Unreal Engine 5.8 C++ prototype with a numbered series of fireball art studies, a city generated from OpenStreetMap data, and a standalone test suite for the simulation logic.',
      points: [
        'A numbered series of written studies shows each round of the effect being reviewed and improved.',
        'The simulation logic has its own automated tests, separate from the game engine.',
      ],
      nongoals: 'A source-code prototype, not a finished or fully tested game; running it end to end in the engine is still to be verified.',
    },
    zh: {
      title: '爆炸特效研究',
      tag: '研究怎麼讓爆炸特效看起來真實',
      summary:
        '用遊戲引擎當實驗場，研究電影級爆炸特效：火球的形狀、衝擊環、飄散的塵雲，以及在用開放地圖資料重建的真實城市街區上打光。場景是虛構的沙盒，所有參數都是假設的。',
      tech: 'Unreal Engine 5.8 的 C++ 原型：一系列編號的火球美術研究、以 OpenStreetMap 資料產生的城市，以及獨立的模擬邏輯測試。',
      points: [
        '一系列編號的書面研究，記錄特效每一輪的檢視與改進。',
        '模擬邏輯有自己的自動化測試，與遊戲引擎分開。',
      ],
      nongoals: '這是原始碼原型，不是完成或完整測試過的遊戲；在引擎中完整跑一遍仍待驗證。',
    },
  },
  {
    slug: 'local-ai',
    kind: 'thinking',
    en: {
      title: 'An AI that has to ask permission',
      tag: 'A personal AI that runs on my own computer and needs a person to approve changes',
      summary:
        'A personal AI assistant that runs entirely on my own computer, so my data does not leave it. It can only use a short list of approved tools, and anything that writes a file waits for a person to approve it first. Results are then checked independently, by file size and a checksum, instead of taking the AI at its word.',
      tech: 'Local-model stack (LM Studio, Open WebUI, Flowise, Letta) behind a tool-allowlisting runtime with audit logs, human approval gates, localhost-only ports, secrets kept in the OS keychain, and SHA-256 verified health reports.',
      points: [
        'A recorded demo shows the safety net working: the AI said it would create a file but never did, and the independent check marked the task as not done.',
        'The demo also lists what did not count as a success, instead of hiding it.',
      ],
      nongoals: 'A personal setup, not a product. The high-privilege coding sandbox is deliberately not started automatically.',
    },
    zh: {
      title: '做事前必須先問過人的 AI',
      tag: '跑在自己電腦上、任何改動都要人批准的個人 AI',
      summary:
        '一個完全在自己電腦上運作的個人 AI 助理，所以資料不會離開這台電腦。它只能使用一份簡短的核准工具清單，凡是要寫入檔案的動作，都得先等人批准。結果再由獨立的檢查（檔案大小與雜湊值）來驗證，而不是直接相信 AI 的說法。',
      tech: '本機模型堆疊（LM Studio、Open WebUI、Flowise、Letta），搭配工具白名單 runtime、稽核紀錄、人工核准閘門、只開本機端口、密鑰存在系統鑰匙圈，以及附 SHA-256 的健康檢查報告。',
      points: [
        '一段錄製的示範呈現了安全網的作用：AI 說要建立檔案卻沒有做，獨立檢查把這個任務判定為未完成。',
        '示範也列出「不算成功」的項目，而不是把它藏起來。',
      ],
      nongoals: '這是個人的設置，不是產品。高權限的程式沙箱刻意不會自動啟動。',
    },
  },
  {
    slug: 'proof-notes',
    kind: 'thinking',
    en: {
      title: 'How to prove a system is right, not just fast',
      tag: 'A checklist for deciding whether a change is safe to release',
      summary:
        'Working notes on deciding whether a change to a map or location search is trustworthy enough to release. The key idea is to keep two questions apart: is the answer right, and is it fast? Each needs a different kind of evidence, and one is never allowed to stand in for the other.',
      tech: 'Correctness proof (oracle comparison on hard cases) versus performance proof (EXPLAIN (ANALYZE, BUFFERS), P50/P95/P99 latency), plus staged rollout behind feature flags.',
      points: [
        'Three levels of proof: checks and tests only; real measurements on hard cases; then a gradual release that is watched in production.',
        'A simple rule: without a comparison against a trusted reference answer, nobody may claim the result is correct.',
      ],
      nongoals: 'Personal working notes, not a published standard or a tool.',
    },
    zh: {
      title: '怎麼證明系統是對的，而不只是很快',
      tag: '判斷一項改動能不能安全上線的檢查清單',
      summary:
        '一份工作筆記，討論怎麼判斷地圖或位置搜尋的改動夠不夠可信、能不能上線。核心想法是把兩個問題分開：答案對不對？速度快不快？兩者需要不同的證據，而且其中一個不能拿來頂替另一個。',
      tech: '正確性證明（在困難案例上與 oracle 對照）對比效能證明（EXPLAIN (ANALYZE, BUFFERS)、P50/P95/P99 延遲），再搭配 feature flag 的漸進式上線。',
      points: [
        '三個證明等級：只做檢查與測試；在困難案例上做實際量測；最後是在線上被監看的漸進式上線。',
        '一條簡單的規則：沒有和可信的參考答案對照，就不能宣稱結果是正確的。',
      ],
      nongoals: '這是個人的工作筆記，不是公開的標準，也不是工具。',
    },
  },
  {
    slug: 'evidence-plan',
    kind: 'thinking',
    en: {
      title: 'A business plan that shows its evidence',
      tag: 'Turning a business idea into claims that can be tested',
      summary:
        'A long business white paper in which every important claim is labelled as a fact, a stand-in measure, or an assumption, with a grade for how strong the evidence is and a next step to firm it up. The point is to keep an exciting idea honest.',
      tech: 'Research evidence ledger: claim inventory, evidence grading (A/B/C), "next evidence" per claim, and a two-week / four-week backlog.',
      points: [
        'Every key claim has a written next step for finding better evidence.',
        'Comes with a market study of competitors and a set of charts.',
      ],
      nongoals: 'The venture itself is private and is not described here; this shows the method only.',
    },
    zh: {
      title: '每個主張都附上證據的商業企劃',
      tag: '把一個商業構想拆成可以被檢驗的主張',
      summary:
        '一份很長的商業白皮書，其中每個重要主張都被標成「事實」「替代指標」或「假設」，並附上證據強度的分級，以及補強證據的下一步。重點是讓一個令人興奮的構想保持誠實。',
      tech: '研究證據清單（evidence ledger）：主張盤點、證據分級（A/B/C）、每個主張的「下一步證據」，以及兩週／四週的待辦。',
      points: [
        '每個關鍵主張都寫明了如何找到更好證據的下一步。',
        '附有競爭對手的市場研究與一組圖表。',
      ],
      nongoals: '該事業本身屬於私人內容，這裡不會描述；這裡只展示方法。',
    },
  },
  {
    slug: 'posture-wearable',
    kind: 'design',
    en: {
      title: 'A backpack that nudges you to sit up straight',
      tag: 'A wearable design proposal that is honest about what is not tested yet',
      summary:
        'A design proposal for a wearable that notices when your posture slumps and nudges you with soft air cushions and small vibrations, instead of loud alarms. The same sensing core can be worn with or without a bag. It was prepared for a university course on wearable technology.',
      tech: 'Flex-sensor sensing with per-user calibration, paired air bladders and haptic cues, a detachable-bag modular architecture; an Arduino prototype demonstrates one calibrated sensor.',
      points: [
        'It guides rather than forces: it only nudges, and the person stays in control.',
        'The slides separate what was actually demonstrated from what is only proposed, and mark all three configurations as not yet physically tested.',
      ],
      nongoals: 'Not a medical device and not a diagnosis; the design has not been tested on people.',
    },
    zh: {
      title: '會輕輕提醒你坐直的背包',
      tag: '一份誠實標明「還沒測試什麼」的穿戴裝置設計提案',
      summary:
        '一份穿戴裝置的設計提案：它會察覺你姿勢變得鬆垮，並用柔軟的氣囊與輕微的振動提醒你，而不是響亮的警報。同一個感測核心可以搭配背包使用，也可以不帶包單獨穿戴。這是為一門大學穿戴科技課程準備的。',
      tech: '以 Flex 感測器搭配個人化校正、成對氣囊與觸覺提示、可拆換包體的模組化架構；以 Arduino 原型展示單一已校正的感測器。',
      points: [
        '它是「引導」而不是「強制」：只輕輕提醒，由使用者自己掌控。',
        '簡報把「實際展示過的」和「只是提案的」分開，並標明三種配置都尚未經過實體驗證。',
      ],
      nongoals: '不是醫療器材，也不是診斷；這個設計還沒有在人身上測試過。',
    },
  },
];

export const skillGroups = [
  {
    key: 'fix',
    en: ['What I fix', ['Things that happen twice, or not at all (retries and duplicates)', 'Messages that get lost between systems (outbox / inbox)', 'Several workers editing the same data at the same time', 'Database changes that are all-or-nothing, safe upgrades, and each customer\'s data kept apart']],
    zh: ['我處理的問題', ['同一件事做了兩次、或根本沒做（重試與重複）', '訊息在系統之間遺失（outbox / inbox）', '多個工作程序同時修改同一份資料', '資料庫的修改要嘛全成功、要嘛全不動；安全升級；各客戶的資料互相隔離']],
  },
  {
    key: 'tools',
    en: ['Tools I build with', ['C# / .NET 8', 'Rust', 'TypeScript', 'Go', 'PostgreSQL (database)']],
    zh: ['我使用的工具', ['C# / .NET 8', 'Rust', 'TypeScript', 'Go', 'PostgreSQL（資料庫）']],
  },
  {
    key: 'practice',
    en: ['How I work', ['Reproduce the problem on purpose, then prove the fix', 'Automated tests, including against a real database', 'Design decisions written down', 'Only claim what the tests and documents support']],
    zh: ['我的做法', ['刻意重現問題，再證明修復有效', '自動化測試，包含對真實資料庫的測試', '把設計決定寫下來', '只主張測試與文件能證明的事']],
  },
];

export const ui = {
  en: {
    role: 'Backend / Platform Engineer',
    documentTitle: 'Ezra Wu — Backend / Platform Engineer',
    inputLabel: 'Command input',
    chipsLabel: 'Quick commands',
    skip: 'Skip to the command line',
    themeButton: 'Cycle colour theme',
    langButton: 'Switch language',
    welcome: 'I make the behind-the-scenes parts of software reliable: no lost messages, no repeated actions, no overwritten data.',
    welcomeHint: ['Type ', { cmd: 'help' }, ' or tap a command below. Tab completes, ↑ recalls.'],
    boot: ['loading profile', 'mounting /projects', 'ready'],
    bootCount: (n) => `mounting /projects (${n} public repositories)`,
    cmds: {
      about: 'who I am and how I work',
      projects: 'things I have built (public)',
      works: 'other work worth a look',
      work: 'details of one piece of work',
      skills: 'what I can help with',
      contact: 'how to reach me',
      ls: 'list files',
      cat: 'print a file',
      open: 'open a link in a new tab',
      theme: 'dark | light | amber | matrix',
      lang: 'en | zh',
      ascii: 'an ASCII face that watches you',
      '3d': 'a spinning 3D model made of text',
      fx: 'both | rain | network | off',
      transition: 'auto | dissolve | scan | rain | off',
      cursor: 'full | minimal | off',
      hud: 'show or hide the overview pane (on | off)',
      clear: 'clear the screen',
      history: 'previous commands',
      help: 'this list',
    },
    asciiLabel: 'Animated ASCII face',
    asciiHint: 'Move the pointer: it watches. Type: it listens.',
    modelLabel: (shape) => `Spinning ASCII 3D model: ${shape}`,
    modelHint: ['Move the pointer to steer it. Try ', { cmd: '3d cube' }, ', ', { cmd: '3d sphere' }, ' or ', { cmd: '3d donut' }, '.'],
    modelBad: (q, all) => `3d: unknown shape "${q}" (available: ${all})`,
    fxCurrent: (cur, all) => `fx: ${cur}   (available: ${all})`,
    fxSet: (m) => `background effect set to ${m}`,
    fxBad: (q, all) => `fx: unknown mode "${q}" (available: ${all})`,
    fxButton: 'Cycle background effect',
    transitionCurrent: (cur, all) => `transition: ${cur}   (available: ${all})`,
    transitionSet: (m) => `ASCII transition set to ${m}`,
    transitionBad: (q, all) => `transition: unknown mode "${q}" (available: ${all})`,
    cursorCurrent: (cur, all) => `cursor: ${cur}   (available: ${all})`,
    cursorSet: (m) => `reticle cursor set to ${m}`,
    cursorBad: (q, all) => `cursor: unknown mode "${q}" (available: ${all})`,
    hudCurrent: (cur, all) => `hud: ${cur}   (available: ${all}; the overview sits beside the terminal on screens 1000px or wider, and behind a tab on narrower ones)`,
    hudSet: (m) => `overview pane ${m}`,
    hudBad: (q, all) => `hud: unknown mode "${q}" (available: ${all})`,
    hudRecent: 'Recent commands',
    hudEmpty: 'no commands yet',
    gui: {
      label: 'Overview',
      tabs: 'View',
      tabGui: 'Overview',
      tabTerm: 'Terminal',
      aboutButton: 'about me',
      hint: 'Click a card: the terminal runs the command and shows the details.',
      sections: { projects: 'PROJECTS', works: 'WORKS', skills: 'SKILLS', contact: 'CONTACT', system: 'SYSTEM' },
      github: 'GitHub profile',
      repos: (n) => `${n} public repositories`,
    },
    helpTitle: 'Available commands',
    helpFooter: ['Tip: ', { cmd: 'ls' }, ' shows files, ', { cmd: 'cat about.md' }, ' reads one. Shortcuts: Tab, ↑/↓, Ctrl+L.'],
    aboutTitle: 'about',
    bio: [
      'I am a software engineer (Backend / Platform Engineer). I help teams that already have a working product fix the hidden reliability problems behind it: the database, the background jobs, and the way different parts of a system pass messages to each other.',
      'My specialty is failures that look safe but are not: something that can occasionally happen twice, get lost, or be overwritten. Think of an order that is saved but never announced to the warehouse, or a notification that goes out twice.',
      'Work is fixed-scope: a diagnosis, a review of the design and code, reproducing the problem on purpose, then the fix. Everything is written down, communication is asynchronous, and payment follows milestones.',
    ],
    workStyleTitle: 'how I work',
    workStyle: 'I do not just say it works; I show how I know. Every claim is tied to a test, a document, or an honest note of what is not claimed. When something goes wrong in timing or in the numbers, I make it visible instead of smoothing it over.',
    aboutNext: ['Next: ', { cmd: 'projects' }, ', ', { cmd: 'skills' }, ', ', { cmd: 'contact' }],
    worksTitle: 'works',
    worksHint: ['Run ', { cmd: 'work 1' }, ' (or a name) for details. These are described without private names, partners or figures.'],
    workKinds: { visual: 'Visual and 3D', thinking: 'Research and thinking', design: 'Design' },
    workLabels: { kind: 'kind', repo: 'repo' },
    workUsage: ['usage: work <number | name>   (see ', { cmd: 'works' }, ')'],
    noWork: (q) => `work: no match for "${q}"`,
    projectsTitle: 'projects',
    projectsHint: ['Public projects. Run ', { cmd: 'project 1' }, ' (or a name) for details.'],
    projectLabels: { stack: 'built with', repo: 'repo', notes: 'not claimed', tech: 'for engineers' },
    skillsTitle: 'skills',
    contactTitle: 'contact',
    contactLabels: { github: 'github', email: 'email', mode: 'how' },
    contactMode: 'Tell me what is going wrong in plain words, and what system you use if you know. I reply in writing.',
    labels: { language: 'language', theme: 'theme', role: 'role', repos: 'repos', shell: 'shell' },
    notFound: (c) => `command not found: ${c}`,
    didYouMean: (c) => ['Did you mean ', { cmd: c }, '?'],
    tryHelp: ['Type ', { cmd: 'help' }, ' for the list of commands.'],
    noFile: (p) => `cat: ${p}: No such file or directory`,
    isDir: (p) => `cat: ${p}: Is a directory`,
    notDir: (p) => `ls: ${p}: Not a directory`,
    noSuchDir: (p) => `ls: ${p}: No such file or directory`,
    catUsage: ['usage: cat <file>   (try ', { cmd: 'ls' }, ')'],
    noProject: (q) => `project: no match for "${q}"`,
    projectUsage: ['usage: project <number | name>'],
    openUsage: (names) => `usage: open <${names}>`,
    openBad: (q) => `open: unknown target "${q}"`,
    opening: (u) => `opening ${u}`,
    themeCurrent: (cur, all) => `theme: ${cur}   (available: ${all})`,
    themeSet: (t) => `theme set to ${t}`,
    themeBad: (q, all) => `theme: unknown theme "${q}" (available: ${all})`,
    langCurrent: (cur) => `language: ${cur}   (available: en, zh)`,
    langSet: (n) => `language set to ${n}`,
    langBad: (q) => `lang: unknown language "${q}" (available: en, zh)`,
    historyEmpty: 'history is empty',
    whoami: 'ezra, Backend / Platform Engineer',
    sudo: 'ezra is not in the sudoers file. This incident will be reported.',
    exit: 'There is no exit, only `help`.',
    completions: 'matches',
  },
  zh: {
    role: '後端／平台工程師',
    documentTitle: 'Ezra Wu — 後端／平台工程師',
    inputLabel: '指令輸入',
    chipsLabel: '快速指令',
    skip: '跳到指令列',
    themeButton: '切換色彩主題',
    langButton: '切換語言',
    welcome: '我讓軟體幕後的部分更可靠：不漏訊息、不重複執行、不覆蓋資料。',
    welcomeHint: ['輸入 ', { cmd: 'help' }, ' 或點選下方指令。Tab 可補全，↑ 可叫回上一個指令。'],
    boot: ['載入個人資料', '掛載 /projects', '就緒'],
    bootCount: (n) => `掛載 /projects（${n} 個公開儲存庫）`,
    cmds: {
      about: '我是誰、怎麼工作',
      projects: '我做過的東西（公開）',
      works: '其他值得一看的作品',
      work: '單一作品的詳情',
      skills: '我能幫上什麼',
      contact: '聯絡方式',
      ls: '列出檔案',
      cat: '顯示檔案內容',
      open: '在新分頁開啟連結',
      theme: 'dark | light | amber | matrix',
      lang: 'en | zh',
      ascii: '會看著你的 ASCII 臉',
      '3d': '用文字畫出來的旋轉 3D 模型',
      fx: 'both | rain | network | off',
      transition: 'auto | dissolve | scan | rain | off',
      cursor: 'full | minimal | off',
      hud: '顯示或隱藏左側概覽（on | off）',
      clear: '清除畫面',
      history: '歷史指令',
      help: '顯示這份清單',
    },
    asciiLabel: '會動的 ASCII 臉',
    asciiHint: '移動游標：它會看著你。打字：它會聽。',
    modelLabel: (shape) => `旋轉的 ASCII 3D 模型：${shape}`,
    modelHint: ['移動游標可以控制轉動。試試 ', { cmd: '3d cube' }, '、', { cmd: '3d sphere' }, ' 或 ', { cmd: '3d donut' }, '。'],
    modelBad: (q, all) => `3d：未知的形狀「${q}」（可用：${all}）`,
    fxCurrent: (cur, all) => `fx：${cur}（可用：${all}）`,
    fxSet: (m) => `背景特效已切換為 ${m}`,
    fxBad: (q, all) => `fx：未知的模式「${q}」（可用：${all}）`,
    fxButton: '切換背景特效',
    transitionCurrent: (cur, all) => `transition：${cur}（可用：${all}）`,
    transitionSet: (m) => `ASCII 轉場已切換為 ${m}`,
    transitionBad: (q, all) => `transition：未知的模式「${q}」（可用：${all}）`,
    cursorCurrent: (cur, all) => `cursor：${cur}（可用：${all}）`,
    cursorSet: (m) => `準星游標已切換為 ${m}`,
    cursorBad: (q, all) => `cursor：未知的模式「${q}」（可用：${all}）`,
    hudCurrent: (cur, all) => `hud：${cur}（可用：${all}；螢幕寬度 1000px 以上時概覽會在終端機旁邊，較窄時放在分頁裡）`,
    hudSet: (m) => `概覽區：${m}`,
    hudBad: (q, all) => `hud：未知的模式「${q}」（可用：${all}）`,
    hudRecent: '最近指令',
    hudEmpty: '尚無指令',
    gui: {
      label: '概覽',
      tabs: '檢視',
      tabGui: '概覽',
      tabTerm: '終端機',
      aboutButton: '關於我',
      hint: '點一張卡片：終端機會執行對應的指令並顯示詳情。',
      sections: { projects: '專案', works: '作品', skills: '技能', contact: '聯絡', system: '系統' },
      github: 'GitHub 個人頁',
      repos: (n) => `${n} 個公開儲存庫`,
    },
    helpTitle: '可用指令',
    helpFooter: ['提示：', { cmd: 'ls' }, ' 列出檔案，', { cmd: 'cat about.md' }, ' 讀取檔案。快捷鍵：Tab、↑/↓、Ctrl+L。'],
    aboutTitle: 'about',
    bio: [
      '我是軟體工程師（後端／平台工程師）。協助已經有產品在運作的團隊，處理背後看不見的可靠性問題：資料庫、背景工作，以及系統各部分之間傳遞訊息的方式。',
      '我擅長找出「看起來有保護、其實不安全」的錯誤：同一件事可能偶爾做了兩次、漏掉，或是被覆蓋。例如訂單存好了卻沒通知倉庫，或同一則通知發了兩次。',
      '合作方式為固定範圍：先做診斷、檢視設計與程式碼、刻意把問題重現，再修復。所有結論都有文字紀錄，以非同步溝通為主，依里程碑付款。',
    ],
    workStyleTitle: '工作原則',
    workStyle: '我不只說「沒問題」，而是說明我怎麼知道。每個說法都對應到測試、文件，或老實註明哪些沒有主張。時間點或數字出了問題時，我讓它被看見，而不是被抹平。',
    aboutNext: ['接著看：', { cmd: 'projects' }, '、', { cmd: 'skills' }, '、', { cmd: 'contact' }],
    worksTitle: 'works',
    worksHint: ['執行 ', { cmd: 'work 1' }, '（或名稱）查看詳情。這些作品的描述不含私人名稱、合作對象或數字。'],
    workKinds: { visual: '視覺與 3D', thinking: '研究與思考', design: '設計' },
    workLabels: { kind: '類別', repo: '儲存庫' },
    workUsage: ['用法：work <編號 | 名稱>（見 ', { cmd: 'works' }, '）'],
    noWork: (q) => `work：找不到「${q}」`,
    projectsTitle: 'projects',
    projectsHint: ['公開專案。執行 ', { cmd: 'project 1' }, '（或名稱）查看詳情。'],
    projectLabels: { stack: '使用技術', repo: '儲存庫', notes: '不主張', tech: '給工程師' },
    skillsTitle: 'skills',
    contactTitle: 'contact',
    contactLabels: { github: 'github', email: 'email', mode: '方式' },
    contactMode: '用白話告訴我哪裡出了問題，以及你們用的系統（不確定也沒關係）。我會以文字回覆。',
    labels: { language: '語言', theme: '主題', role: '角色', repos: '儲存庫', shell: 'shell' },
    notFound: (c) => `找不到指令：${c}`,
    didYouMean: (c) => ['你是不是要輸入 ', { cmd: c }, '？'],
    tryHelp: ['輸入 ', { cmd: 'help' }, ' 查看所有指令。'],
    noFile: (p) => `cat: ${p}：沒有這個檔案或目錄`,
    isDir: (p) => `cat: ${p}：是一個目錄`,
    notDir: (p) => `ls: ${p}：不是目錄`,
    noSuchDir: (p) => `ls: ${p}：沒有這個檔案或目錄`,
    catUsage: ['用法：cat <檔案>（試試 ', { cmd: 'ls' }, '）'],
    noProject: (q) => `project：找不到「${q}」`,
    projectUsage: ['用法：project <編號 | 名稱>'],
    openUsage: (names) => `用法：open <${names}>`,
    openBad: (q) => `open：未知的目標「${q}」`,
    opening: (u) => `正在開啟 ${u}`,
    themeCurrent: (cur, all) => `主題：${cur}（可用：${all}）`,
    themeSet: (t) => `主題已切換為 ${t}`,
    themeBad: (q, all) => `theme：未知的主題「${q}」（可用：${all}）`,
    langCurrent: (cur) => `語言：${cur}（可用：en, zh）`,
    langSet: (n) => `語言已切換為 ${n}`,
    langBad: (q) => `lang：未知的語言「${q}」（可用：en, zh）`,
    historyEmpty: '尚無歷史指令',
    whoami: 'ezra，後端／平台工程師',
    sudo: 'ezra 不在 sudoers 名單中。此事件將被回報。',
    exit: '沒有出口，只有 `help`。',
    completions: '符合項目',
  },
};
