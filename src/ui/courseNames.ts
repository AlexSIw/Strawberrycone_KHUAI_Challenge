// Concept cards cite lectures by the students' short course names; judges and beginners need the full ones.

const COURSE: Record<string, string> = {
  마서프: '마이크로서비스프로그래밍',
  풀서네: '풀스택서비스네트워킹',
};

/** "마서프 Lec20 · 풀서네 Lec01" → "마이크로서비스프로그래밍 Lec20 · 풀스택서비스네트워킹 Lec01" */
export const courseLabel = (s: string): string => s.replace(/마서프|풀서네/g, (m) => COURSE[m] ?? m);
