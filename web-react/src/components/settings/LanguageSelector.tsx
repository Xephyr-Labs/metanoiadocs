import { Languages } from 'lucide-react';
import { useState } from 'react';
import {
  changeLanguage,
  getLanguage,
  LANGUAGES,
  type Language,
} from '../../lib/i18n';

export function LanguageSelector() {
  const [language, setLanguage] = useState<Language>(getLanguage);

  const change = (value: Language) => {
    setLanguage(value);
    changeLanguage(value);
  };

  return (
    <div className="flex flex-col gap-2 py-3.5 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between min-[600px]:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">Language</p>
        <p className="mt-0.5 text-xs leading-snug text-muted">
          Choose the language used by the interface.
        </p>
      </div>

      <div className="flex w-full items-center gap-2 min-[600px]:w-auto">
        <Languages size={15} className="text-faint" />

        <select
          value={language}
          onChange={(e) => change(e.target.value as Language)}
          className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none"
          aria-label="Language"
        >
          {LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
