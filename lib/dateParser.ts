export function parseNaturalDate(expression: string, referenceDate = new Date()): string {
  const expr = expression.toLowerCase().trim();
  const d = new Date(referenceDate);

  // "tomorrow"
  if (expr === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }

  // "today"
  if (expr === 'today') {
    return toISO(d);
  }

  // "next [weekday]"
  const nextDay = expr.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (nextDay) {
    return getNextWeekday(nextDay[1], d);
  }

  // "this [weekday]" - if already passed, gets next week's occurrence
  const thisDay = expr.match(/this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (thisDay) {
    return getThisWeekday(thisDay[1], d);
  }

  // "last weekday of this month"
  if (expr.includes('last weekday') && expr.includes('month')) {
    return getLastWeekdayOfMonth(d);
  }

  // "end of next week" / "late next week"
  if (expr.includes('next week')) {
    const nextMon = getNextWeekday('monday', d);
    const nextFri = new Date(nextMon);
    nextFri.setDate(nextFri.getDate() + 4);
    if (expr.includes('late') || expr.includes('end')) {
      nextFri.setDate(nextFri.getDate() - 1); // Thursday as "late next week"
    }
    return toISO(nextFri);
  }

  // "next Monday" patterns - already handled above

  // "March 20th" / "June 20" / "20th March"
  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december';
  const specificDate = expr.match(new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?`));
  if (specificDate) {
    const parsed = new Date(`${specificDate[1]} ${specificDate[2]} ${d.getFullYear()}`);
    if (!isNaN(parsed.getTime())) return toISO(parsed);
  }

  // Also check "20th March" format
  const reverseDate = expr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(${monthNames})/);
  if (reverseDate) {
    const parsed = new Date(`${reverseDate[2]} ${reverseDate[1]} ${d.getFullYear()}`);
    if (!isNaN(parsed.getTime())) return toISO(parsed);
  }

  // Direct ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(expr)) {
    return expr;
  }

  return toISO(d); // fallback to today
}

function toISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getNextWeekday(day: string, from: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = days.indexOf(day.toLowerCase());
  const current = from.getDay();
  let diff = target - current;
  if (diff <= 0) diff += 7;
  const result = new Date(from);
  result.setDate(from.getDate() + diff);
  return toISO(result);
}

function getThisWeekday(day: string, from: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = days.indexOf(day.toLowerCase());
  const current = from.getDay();
  let diff = target - current;
  // If target day is today or already passed this week, get next week's occurrence
  if (diff <= 0) diff += 7;
  const result = new Date(from);
  result.setDate(from.getDate() + diff);
  return toISO(result);
}

function getLastWeekdayOfMonth(from: Date): string {
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  while (lastDay.getDay() === 0 || lastDay.getDay() === 6) {
    lastDay.setDate(lastDay.getDate() - 1);
  }
  return toISO(lastDay);
}