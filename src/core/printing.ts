import { z } from "zod";
export const fontFamilySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N} .,'()&_+-]+$/u);
export const languageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/)
  .max(35);
export const printLanguages = [
  { code: "en", name: "English", sample: "English", font: "DejaVu Sans" },
  { code: "ta", name: "Tamil · தமிழ்", sample: "தமிழ்", font: "Nirmala UI" },
  { code: "hi", name: "Hindi · हिन्दी", sample: "हिन्दी", font: "Nirmala UI" },
  { code: "te", name: "Telugu · తెలుగు", sample: "తెలుగు", font: "Nirmala UI" },
  {
    code: "ml",
    name: "Malayalam · മലയാളം",
    sample: "മലയാളം",
    font: "Nirmala UI",
  },
  { code: "kn", name: "Kannada · ಕನ್ನಡ", sample: "ಕನ್ನಡ", font: "Nirmala UI" },
  { code: "bn", name: "Bengali · বাংলা", sample: "বাংলা", font: "Nirmala UI" },
  { code: "mr", name: "Marathi · मराठी", sample: "मराठी", font: "Nirmala UI" },
  {
    code: "gu",
    name: "Gujarati · ગુજરાતી",
    sample: "ગુજરાતી",
    font: "Nirmala UI",
  },
  {
    code: "pa",
    name: "Punjabi · ਪੰਜਾਬੀ",
    sample: "ਪੰਜਾਬੀ",
    font: "Nirmala UI",
  },
  { code: "or", name: "Odia · ଓଡ଼ିଆ", sample: "ଓଡ଼ିଆ", font: "Nirmala UI" },
  { code: "si", name: "Sinhala · සිංහල", sample: "සිංහල", font: "Nirmala UI" },
  { code: "ne", name: "Nepali · नेपाली", sample: "नेपाली", font: "Nirmala UI" },
  { code: "ar", name: "Arabic · العربية", sample: "العربية", font: "Arial" },
  { code: "ur", name: "Urdu · اردو", sample: "اردو", font: "Arial" },
  { code: "he", name: "Hebrew · עברית", sample: "עברית", font: "Arial" },
  { code: "th", name: "Thai · ไทย", sample: "ไทย", font: "Tahoma" },
  {
    code: "zh",
    name: "Chinese · 中文",
    sample: "中文",
    font: "Microsoft YaHei",
  },
  {
    code: "ja",
    name: "Japanese · 日本語",
    sample: "日本語",
    font: "Yu Gothic",
  },
  {
    code: "ko",
    name: "Korean · 한국어",
    sample: "한국어",
    font: "Malgun Gothic",
  },
  { code: "fr", name: "French · Français", sample: "Français", font: "Arial" },
  { code: "de", name: "German · Deutsch", sample: "Deutsch", font: "Arial" },
  { code: "es", name: "Spanish · Español", sample: "Español", font: "Arial" },
];
export const legacyFonts = ["DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono"];
