// Single source of truth for graph categories. Used by graph builder, cleaner, and tests.
// NEW in this redesign: 'Quellen' for news domains/blogs/magazines.
export const VALID_CATS = ['Personen', 'Tiere', 'Firmen', 'Orte', 'Themen', 'Quellen']

export const DOMAIN_RE = /[a-z0-9-]+\.(com|de|at|net|org|io|ai|rocks|blog|news|info)$/i

export function isDomain(name) { return DOMAIN_RE.test(String(name).trim()) }
