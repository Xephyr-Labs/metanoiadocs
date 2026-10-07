export type Language = 'en' | 'zh-TW';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '繁體中文' },
];

const STORAGE_KEY = 'metanoiadocs-language';

const zhTW: Record<string, string> = {
  // Settings
  Settings: '設定',
  Account: '帳號',
  Workspace: '工作區',
  'My account': '我的帳號',
  Preferences: '偏好設定',
  'API tokens': 'API Token',
  Members: '成員',
  AI: 'AI',
  Webhooks: 'Webhooks',
  About: '關於',

  Name: '名稱',
  Username: '使用者名稱',
  Email: '電子郵件',
  'Time zone': '時區',
  Password: '密碼',
  Change: '變更',
  'Change password': '變更密碼',
  'Current password': '目前密碼',
  'New password — at least 8 characters': '新密碼 — 至少 8 個字元',
  'New password again': '再次輸入新密碼',

  Cancel: '取消',
  Save: '儲存',
  Saved: '已儲存',

  // Appearance
  Appearance: '外觀',
  'Pick a light or dark theme.': '選擇淺色或深色主題。',
  Light: '淺色',
  Dark: '深色',

  'Smaller text': '較小文字',
  'Reduce the editor font size.': '縮小編輯器文字大小。',

  'Desktop notifications': '桌面通知',
  'Email notifications': '電子郵件通知',
  'Test notifications': '測試通知',
  'Send test': '傳送測試',

  'Calendar subscription': '行事曆訂閱',

  Copy: '複製',
  Copied: '已複製',

  Invite: '邀請',
  'Invite by email': '透過電子郵件邀請',
  'Send invite': '傳送邀請',

  Role: '角色',
  Admin: '管理員',
  Collaborator: '協作者',
  Remove: '移除',

  Language: '語言',
  'Choose the language used by the interface.': '選擇介面使用的語言。',
  English: 'English',
  '繁體中文': '繁體中文',

  Version: '版本',
  Editor: '編輯器',
  Build: '建置',
  Plan: '方案',
  'Free · unlimited members, forever': '免費 · 永久不限成員',

  'Close settings': '關閉設定',
  'Customize how Metanoia looks and behaves for you.':
    '自訂 Metanoia 的外觀與使用方式。',

  // Authentication
  'Sign in': '登入',
  'Sign out': '登出',
  'Log out': '登出',

  // Main navigation
  Search: '搜尋',
  Home: '首頁',
  Documents: '文件',
  Tasks: '任務',
  Projects: '專案',
  Inbox: '收件匣',
  Favorites: '收藏',
  Tags: '標籤',
  Trash: '垃圾桶',

  // Common actions
  Share: '分享',
  Comment: '評論',
  Comments: '評論',
  Notifications: '通知',

  'Loading…': '載入中…',
  'Loading...': '載入中…',

  Close: '關閉',
  Delete: '刪除',
  Edit: '編輯',
  Done: '完成',
  Back: '返回',
  Next: '下一步',
  Everything: '全部',

  // Sidebar
  'All documents': '所有文件',
  Recent: '最近',
  Pinned: '釘選',
  Folders: '資料夾',
  Private: '私人',
  'Public links': '公開連結',
  'Shared with me': '與我分享',
  Designs: '設計',
  Templates: '範本',

  'New page': '新增頁面',
  'New task': '新增任務',

  'New database': '新增資料庫',
  'New data database': '新增資料資料庫',
  'New project': '新增專案',
  'New design': '新增設計',
  'New folder': '新增資料夾',

  'Show fewer': '顯示較少',
  more: '更多',

  'Import…': '匯入…',

  'Close sidebar': '關閉側邊欄',
  'Resize sidebar': '調整側邊欄大小',
  'Sidebar sections': '側邊欄區段',

  'Expand the panel': '展開面板',
  'Collapse the panel': '收合面板',

  // Database actions
  'New database under': '在此資料庫下新增資料庫',
  'New database under {{name}}': '在「{{name}}」下新增資料庫',
  'Actions for': '操作',
  'Actions for {{name}}': '「{{name}}」的操作',
  'Open in a new tab': '在新分頁開啟',
  'Copy link': '複製連結',
  'New database inside': '在其中新增資料庫',
  'New data database inside': '在其中新增資料資料庫',
  'Turn into a task database': '轉為任務資料庫',
  'Turn into a data database': '轉為資料資料庫',
  'Archive database': '封存資料庫',

  'Database name…': '資料庫名稱…',
  'New database name': '新資料庫名稱',

  // Pages / templates
  'New page from': '從此範本新增頁面',
  'New page from {{title}}': '從「{{title}}」新增頁面',

  'Create document': '建立文件',
  'Create task': '建立任務',

  'No documents yet.': '目前沒有文件。',
  'No tasks yet.': '目前沒有任務。',

  // Tags
  'Show pages': '顯示頁面',
  'Delete tag': '刪除標籤',
  'Delete the tag "{{name}}"?':
    '確定要刪除標籤「{{name}}」嗎？',
  'Delete the tag "{{name}}"? It is on {{count}} pages.':
    '確定要刪除標籤「{{name}}」嗎？此標籤目前套用於 {{count}} 個頁面。',
  'Deleted the tag {{name}}.':
    '已刪除標籤「{{name}}」。',

  // Database state changes
  'Could not change {{name}}.':
    '無法變更「{{name}}」。',

  '{{name}} is a data database. Its task fields are hidden, not deleted.':
    '「{{name}}」是資料資料庫，任務欄位已隱藏但未刪除。',

  '{{name}} is a task database again.':
    '「{{name}}」已恢復為任務資料庫。',

  'Could not archive {{name}}.':
    '無法封存「{{name}}」。',

  'Archived {{name}}.':
    '已封存「{{name}}」。',

  'Could not restore {{name}}.':
    '無法復原「{{name}}」。',

  Undo: '復原',

  // Fallback user label
  User: '使用者',
};

// Strings that are still hard-coded in React components.  This keeps the
// existing UI translatable while those components are gradually migrated to t().
const zhTWStaticUI: Record<string, string> = {
  Navigation: '導覽', Main: '主要導覽', Docs: '文件', Menu: '選單', Refresh: '重新整理',
  'Back to sign in': '返回登入', 'Forgot password?': '忘記密碼？', 'Full name': '姓名',
  'Try again': '再試一次', 'Nothing has been changed. Your content is safe on the server.': '沒有任何內容被變更，你的內容仍安全儲存在伺服器上。',
  'How to show these tasks': '任務顯示方式', 'Which tasks': '顯示哪些任務', Link: '連結',
  'More formatting': '更多格式', 'Export as PNG': '匯出為 PNG', 'Editor mode': '編輯器模式',
  'New slide': '新增投影片', 'No slides yet.': '目前沒有投影片。', Present: '簡報播放',
  'View­ing — the page is read-only here.': '檢視中 — 此頁面目前為唯讀。', 'No page open': '尚未開啟頁面',
  'Table of contents': '目錄', 'Add a property': '新增屬性', 'Property name': '屬性名稱', 'Property type': '屬性類型',
  'Change page icon': '變更頁面圖示', 'No tags yet. Type to create one.': '目前沒有標籤，輸入文字即可建立。',
  'Search or create a tag…': '搜尋或建立標籤…', 'Couldn’t load linked pages.': '無法載入連結頁面。',
  'Linked pages': '連結頁面', 'Links from this page': '此頁面的連出連結', 'Links to this page': '連到此頁面的連結',
  'Keyboard shortcuts': '鍵盤快捷鍵', 'Nothing here': '這裡目前沒有內容',
  'This embedded database isn’t available here.': '此處無法使用這個嵌入式資料庫。', 'That database no longer exists.': '該資料庫已不存在。',
  'Pick a database…': '選擇資料庫…', 'Database settings': '資料庫設定', 'Open this database': '開啟此資料庫', 'Resize database': '調整資料庫大小',
  'Checking…': '檢查中…', 'Intake form': '收集表單', 'Replace it': '取代', 'Turn it off': '關閉', 'New address': '新網址', 'Turn off the form': '關閉表單',
  'Task title': '任務標題', 'Open as page': '以頁面開啟', 'Task page actions': '任務頁面操作', 'Edit task types': '編輯任務類型',
  None: '無', Empty: '空白', 'Remove dependency': '移除相依關係', 'Open this page': '開啟此頁面', 'Pick a page…': '選擇頁面…',
  'Delete task': '刪除任務', 'Linked from': '連結來源', 'Remove this link': '移除此連結',
  'No comments yet.': '目前沒有評論。', '(edited)': '（已編輯）', 'Edit this comment': '編輯此評論', 'Delete this comment': '刪除此評論',
  'Add a comment…  @ to mention': '新增評論… 輸入 @ 提及成員', 'Post comment': '送出評論', 'No rows yet.': '目前沒有資料列。',
  'Every property is hidden in this view.': '此檢視中的所有屬性皆已隱藏。', 'Resize column': '調整欄寬', 'Long text': '長文字',
  Agent: '代理程式', 'Hand this to…': '交給…', 'Previous month': '上個月', 'Next month': '下個月', 'Date shown': '顯示日期',
  'No templates yet.': '目前沒有範本。', 'New template': '新增範本', 'All templates': '所有範本', Icon: '圖示', 'Template name': '範本名稱',
  Assignees: '負責人', 'Search people…': '搜尋成員…', 'Card size': '卡片大小', 'No tasks match this view.': '沒有符合此檢視的任務。',
  'Nothing has been finished in the last eight weeks.': '過去八週沒有完成任何任務。', Burndown: '燃盡圖', Velocity: '速度', Throughput: '完成量', Status: '狀態', Workload: '工作量',
  Value: '值', 'Choose…': '選擇…', Field: '欄位', Condition: '條件', 'Remove filter': '移除篩選條件', 'Sort by': '排序依據',
  'Everything is sorted already.': '所有項目都已排序。', Applying: '套用中', 'Clear selection': '清除選取', 'Add an action…': '新增動作…',
  'New type…': '新增類型…', 'New type name': '新類型名稱', 'New sprint': '新增 Sprint', 'Sprint name…': 'Sprint 名稱…', Backlog: '待辦清單',
  'Add task': '新增任務', 'Sprint progress': 'Sprint 進度', 'Sprint actions': 'Sprint 操作', 'Sprint start': 'Sprint 開始', 'Sprint end': 'Sprint 結束',
  'No project selected': '尚未選擇專案', 'Change database icon': '變更資料庫圖示', 'Start from a template': '從範本開始', 'Sprint scope': 'Sprint 範圍',
  'On this page': '此頁面', 'Select text in the page to comment on it.': '選取頁面中的文字即可加入評論。',
  'The text this was about has since changed.': '這則評論所對應的文字已經變更。', 'Replace with': '取代為', Reply: '回覆', 'Reply…': '回覆…', 'Send reply': '送出回覆',
  'Suggested change': '建議變更', 'Remove quote': '移除引用', 'New chat': '新對話', 'Attach this page': '附加此頁面', Stop: '停止', Send: '傳送',
  'No headings yet': '目前沒有標題', 'Quick capture': '快速新增', 'What needs doing?': '需要做什麼？', Saving: '儲存中', 'Which database': '選擇資料庫', 'Pick a database': '選擇資料庫',
  'Filter by name or tag…': '依名稱或標籤篩選…', 'Filter documents': '篩選文件', 'Which documents': '顯示哪些文件', Sort: '排序',
  'Your profile and how others see you.': '你的個人資料以及其他人看到的資訊。', 'Changing it signs out every other browser and device you’re on.': '變更後會登出其他瀏覽器與裝置。',
  Theme: '主題', Enabled: '啟用', 'Provider URL': '服務提供者 URL', Model: '模型', 'API key': 'API 金鑰',
  'Version and workspace information.': '版本與工作區資訊。', 'Token name (e.g. Claude MCP)…': 'Token 名稱（例如 Claude MCP）…',
  'No tokens yet.': '目前沒有 Token。', 'Copy your token now — it won’t be shown again.': '請立即複製 Token，之後將不會再次顯示。',
  'Nothing sent yet.': '目前尚未傳送任何內容。', 'Send a test': '傳送測試', 'New secret': '新增密鑰', 'Recent deliveries': '最近傳送紀錄', 'No webhooks yet.': '目前沒有 Webhook。',
  Back: '返回', 'Open sidebar': '開啟側邊欄', Breadcrumb: '麵包屑導覽', 'Ask AI': '詢問 AI', 'Chat with this page': '與此頁面對話', 'Side panel': '側邊面板', More: '更多',
  'Not now': '稍後再說', You: '你', 'Jump back in': '繼續最近工作', 'Recently opened': '最近開啟', 'All projects': '所有專案',
  'My documents': '我的文件', 'Previous page': '上一頁', 'Next page': '下一頁', 'My open tasks': '我的未完成任務', Overdue: '已逾期', 'Due this week': '本週到期', 'Docs this week': '本週文件',
  'Version history': '版本紀錄', Versions: '版本', Viewing: '檢視中', 'View name': '檢視名稱',
  'Waiting for someone who can edit the page.': '正在等待可編輯此頁面的人員。',
  'You can read this page’s comments. Ask its owner for comment access to join in.': '你可以閱讀此頁面的評論；若要參與討論，請向擁有者要求評論權限。',
  'You can view this page': '你可以檢視此頁面', 'What do you need?': '你需要什麼？',
  'What happened, what you expected, where to look': '發生了什麼、你原本預期什麼，以及需要查看的位置',
  'What people with the link can do': '擁有連結的人可以執行的操作', 'Which column…': '選擇欄位…',
  'Visibility (owner controls this)': '可見性（由擁有者控制）', 'Waits on': '等待項目',
  'Untitled': '未命名', 'Search people…': '搜尋成員…', 'No header': '無標題列',
  'Import CSV': '匯入 CSV', 'Export CSV': '匯出 CSV', 'Create missing properties': '建立缺少的屬性',
  'Download': '下載', 'Upload': '上傳', 'Rename': '重新命名', 'Duplicate': '建立副本',
  'Restore': '復原', 'Archive': '封存', 'Move': '移動', 'Add': '新增', 'Create': '建立',
  'Today': '今天', 'Tomorrow': '明天', 'Yesterday': '昨天', 'This week': '本週',
  'Owner': '擁有者', 'Viewer': '檢視者', 'Member': '成員', 'Guests': '訪客', 'People': '成員',
  'Description': '說明', 'Type': '類型', 'Date': '日期', 'Created': '建立時間', 'Updated': '更新時間',
  'Filter': '篩選', 'Group': '分組', 'Properties': '屬性', 'Views': '檢視', 'Board': '看板', 'Table': '表格', 'Calendar': '行事曆', 'Gallery': '圖庫',
  'Open': '開啟', 'Apply': '套用', 'Clear': '清除', 'Reset': '重設', 'Confirm': '確認', 'Continue': '繼續',
  'Add property': '新增屬性', 'Add filter': '新增篩選條件', 'Add sort': '新增排序', 'Add view': '新增檢視',
  'No results': '沒有結果', 'No results found.': '找不到結果。', 'Search…': '搜尋…', 'Search...': '搜尋…',
};

function translateStaticUIValue(value: string): string {
  if (currentLanguage !== 'zh-TW') return value;

  // Prefer an exact translation first. React often splits one sentence around
  // <strong>, icons, counters, and other inline elements, so a visible text
  // node can also contain a translated phrase plus dynamic content. In that
  // case translate the known phrases without touching URLs, IDs, or code.
  const exact = zhTW[value] ?? zhTWStaticUI[value];
  if (exact) return exact;

  let result = value;
  const phrases = Object.entries({ ...zhTWStaticUI, ...zhTW })
    .filter(([source]) => source.length >= 3 && /[A-Za-z]/.test(source))
    .sort(([a], [b]) => b.length - a.length);

  for (const [source, target] of phrases) {
    if (result.includes(source)) result = result.replaceAll(source, target);
  }
  return result;
}

function translateDOMNode(node: Node): void {
  if (currentLanguage !== 'zh-TW') return;
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent ?? '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    const translated = translateStaticUIValue(trimmed);
    if (translated !== trimmed) node.textContent = raw.replace(trimmed, translated);
    return;
  }
  if (!(node instanceof Element)) return;
  for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
    const raw = node.getAttribute(attr);
    if (!raw) continue;
    const translated = translateStaticUIValue(raw);
    if (translated !== raw) node.setAttribute(attr, translated);
  }
  for (const child of Array.from(node.childNodes)) translateDOMNode(child);
}

export function installDOMTranslations(): void {
  if (currentLanguage !== 'zh-TW') return;
  const run = () => translateDOMNode(document.body);
  if (document.body) run();
  else window.addEventListener('DOMContentLoaded', run, { once: true });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateDOMNode(mutation.target);
      for (const node of Array.from(mutation.addedNodes)) translateDOMNode(node);
      if (mutation.type === 'attributes') translateDOMNode(mutation.target);
    }
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}

let currentLanguage: Language = 'en';

function translate(text: string): string {
  if (currentLanguage === 'en') {
    return text;
  }

  return zhTW[text] ?? text;
}

export function t(
  text: string,
  vars?: Record<string, string | number>,
): string {
  let result = translate(text);

  for (const [key, value] of Object.entries(vars ?? {})) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }

  return result;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function initLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === 'en' || saved === 'zh-TW') {
    currentLanguage = saved;
  } else {
    currentLanguage = 'en';
  }

  return currentLanguage;
}

export function changeLanguage(language: Language): void {
  if (language === currentLanguage) {
    return;
  }

  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);

  window.location.reload();
}
