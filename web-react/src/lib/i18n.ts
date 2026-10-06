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

  // Account
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

  // Common actions
  Cancel: '取消',
  Save: '儲存',
  Saved: '已儲存',
  Copy: '複製',
  Copied: '已複製',
  Close: '關閉',
  Delete: '刪除',
  Edit: '編輯',
  Done: '完成',
  Back: '返回',
  Next: '下一步',
  Remove: '移除',

  // Appearance
  Appearance: '外觀',
  'Pick a light or dark theme.': '選擇淺色或深色主題。',
  Light: '淺色',
  Dark: '深色',
  'Smaller text': '較小文字',
  'Reduce the editor font size.': '縮小編輯器文字大小。',

  // Notifications
  'Desktop notifications': '桌面通知',
  'Email notifications': '電子郵件通知',
  'Test notifications': '測試通知',
  'Send test': '傳送測試',

  // Calendar
  'Calendar subscription': '行事曆訂閱',

  // Members
  Invite: '邀請',
  'Invite by email': '透過電子郵件邀請',
  'Send invite': '傳送邀請',
  Role: '角色',
  Admin: '管理員',
  Collaborator: '協作者',

  // Language
  Language: '語言',
  'Choose the language used by the interface.': '選擇介面使用的語言。',
  English: 'English',
  '繁體中文': '繁體中文',

  // About
  Version: '版本',
  Editor: '編輯器',
  Build: '建置',
  Plan: '方案',
  'Free · unlimited members, forever': '免費 · 永久不限成員',

  // Authentication
  'Close settings': '關閉設定',
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

  // Sidebar sections
  Everything: '全部',
  Designs: '設計',
  Templates: '範本',
  'All documents': '所有文件',
  Recent: '最近',
  Pinned: '釘選',
  Folders: '資料夾',
  Private: '私人',
  'Public links': '公開連結',
  'Shared with me': '與我分享',

  // Sidebar creation
  'New database': '新增資料庫',
  'New data database': '新增資料資料庫',
  'New project': '新增專案',
  'New design': '新增設計',
  'New folder': '新增資料夾',
  'New page': '新增頁面',
  'New task': '新增任務',

  // Sidebar
  'Show fewer': '顯示較少',
  more: '更多',
  'Import…': '匯入…',
  'Close sidebar': '關閉側邊欄',
  'Resize sidebar': '調整側邊欄大小',
  'Sidebar sections': '側邊欄區段',

  // Database
  'Database name…': '資料庫名稱…',
  'New database name': '新資料庫名稱',
  'New page from': '從此範本新增頁面',

  // Documents
  Share: '分享',
  Comment: '留言',
  Comments: '留言',
  Notifications: '通知',

  // Status
  'Loading…': '載入中…',
  'Loading...': '載入中…',

  // Creation / empty states
  'Create document': '建立文件',
  'Create task': '建立任務',
  'No documents yet.': '目前沒有文件。',
  'No tasks yet.': '目前沒有任務。',
};

let currentLanguage: Language = 'en';

function translate(value: string): string {
  if (currentLanguage === 'zh-TW') {
    return zhTW[value] ?? value;
  }

  return value;
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language) {
  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);
}

export function initLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY);

  currentLanguage = saved === 'zh-TW' ? 'zh-TW' : 'en';

  document.documentElement.lang = currentLanguage;
}

export function changeLanguage(language: Language) {
  setLanguage(language);
  document.documentElement.lang = language;

  // 重新載入後，整個 React 介面會使用新的語言。
  window.location.reload();
}

export function t(text: string): string {
  return translate(text);
}
