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
    '自訂 Metanoia 的外觀與行為。',

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
  Comment: '留言',
  Comments: '留言',
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
  'Actions for': '操作',
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
