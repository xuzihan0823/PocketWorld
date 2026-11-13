import type { JournalWeather } from '../../../types/world';

export const JOURNAL_WEATHER: { id: JournalWeather; label: string; paths: string[] }[] = [
  { id: 'sunny', label: '晴', paths: ['M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'] },
  { id: 'cloudy', label: '阴', paths: ['M6 17a4 4 0 0 1-1-7.9A6 6 0 0 1 16.6 8 4.5 4.5 0 1 1 18 17H6Z'] },
  { id: 'rainy', label: '雨', paths: ['M6 17a4 4 0 0 1-1-7.9A6 6 0 0 1 16.6 8 4.5 4.5 0 1 1 18 17H6Z', 'm8 19-1 3m6-3-1 3m6-3-1 3'] },
  { id: 'snowy', label: '雪', paths: ['M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4m10 14-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1'] },
];
