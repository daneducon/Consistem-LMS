// Log local da data de matrícula por (escola, aluno, curso).
// A Hotscool não devolve "dia da matrícula no curso" em nenhum endpoint GET
// (só data_cadastro do aluno), então registramos aqui a cada enrollment com
// sucesso. Sem ele, o dashboard de licenças usa data_cadastro como estimativa.
// NOTA: em serverless (Vercel) o disco é efêmero — vale para dev/VPS; para
// persistir na nuvem, trocar por KV/DB no futuro.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOG_PATH = join(process.cwd(), 'data', 'enrollment-log.json');

function loadAll() {
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(entries) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
}

export function logKey(schoolId, email, courseId) {
  return `${Number(schoolId)}|${String(email || '').trim().toLowerCase()}|${Number(courseId)}`;
}

// Registra (ou renova) a data de matrícula. Chamado nos enrollments com sucesso
// e nas reativações — reativar renova a janela de 30 dias.
export function recordEnrollment({ schoolId, email, courseId, source = 'enrollment' }) {
  try {
    const entries = loadAll();
    const key = logKey(schoolId, email, courseId);
    const at = new Date().toISOString();
    const idx = entries.findIndex((e) => logKey(e.schoolId, e.email, e.courseId) === key);
    const record = {
      schoolId: Number(schoolId),
      email: String(email).trim().toLowerCase(),
      courseId: Number(courseId),
      enrolledAt: at,
      source,
    };
    if (idx >= 0) entries[idx] = record;
    else entries.push(record);
    saveAll(entries);
    return record;
  } catch {
    return null;
  }
}

// Data ISO da matrícula ou null (chamador usa data_cadastro como estimativa).
export function findEnrollmentDate(schoolId, email, courseId) {
  try {
    const entries = loadAll();
    const key = logKey(schoolId, email, courseId);
    const found = entries.find((e) => logKey(e.schoolId, e.email, e.courseId) === key);
    return found?.enrolledAt || null;
  } catch {
    return null;
  }
}
