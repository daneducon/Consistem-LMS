import { filterAuthorizedSchools, requirePermission } from './auth-utils.js';
import { applyRateLimit, requireTrustedGetRequest } from './security.js';
import {
  fetchCoursesFromSchool,
  fetchPackagesFromSchool,
  fetchSchoolName,
  getSchools,
  mapWithConcurrency,
} from './hotscool.js';

// Re-exportados para compatibilidade com importadores existentes.
export {
  fetchCoursesFromSchool,
  fetchPackagesFromSchool,
  fetchSchoolName,
  getSchools,
};
export { fetchPackagesFromAllSchools } from './hotscool.js';

export default async function handler(req, res) {
  const authenticatedUser = await requirePermission(req, res, 'courses:read');
  if (!authenticatedUser) return;
  if (!applyRateLimit(req, res, {
    name: 'courses', identity: authenticatedUser.id, max: 60, windowMs: 60_000,
  })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  if (!requireTrustedGetRequest(req, res)) return;

  try {
    const schools = filterAuthorizedSchools(getSchools(), authenticatedUser);

    if (schools.length === 0) {
      return res.status(500).json({
        error: 'Nenhuma chave de API configurada no .env',
      });
    }

    const { schoolIndex, packages: packagesQuery } = req.query;

    // Se schoolIndex não for passado ou for 'all', retorna a lista de escolas com nomes reais
    if (schoolIndex === undefined || schoolIndex === '') {
      const schoolsWithNames = await mapWithConcurrency(
        schools,
        4,
        async (s) => {
          const realName = await fetchSchoolName(s.apiKey);
          return {
            id: s.id,
            name: realName || s.name,
          };
        },
      );
      return res.status(200).json({
        schools: schoolsWithNames,
      });
    }

    if (!/^\d+$/.test(String(schoolIndex))) {
      return res.status(400).json({ error: 'Escola inválida.' });
    }
    const idx = Number(schoolIndex);
    const targetSchool = schools.find((school) => school.id === idx);

    if (!targetSchool) {
      return res.status(404).json({ error: 'Escola não encontrada.' });
    }

    const courses = await fetchCoursesFromSchool(targetSchool.apiKey);
    const realSchoolName = await fetchSchoolName(targetSchool.apiKey);

    // Suporte a trilhas/packages: ?packages=1
    if (packagesQuery === '1' || packagesQuery === 'true') {
      const packages = await fetchPackagesFromSchool(targetSchool.apiKey);
      return res.status(200).json({
        school: { id: targetSchool.id, name: realSchoolName || targetSchool.name },
        courses,
        packages,
        total: courses.length,
        totalPackages: packages.length,
      });
    }

    return res.status(200).json({
      school: { id: targetSchool.id, name: realSchoolName || targetSchool.name },
      courses: courses,
      total: courses.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar cursos:', error);
    return res.status(500).json({ error: 'Erro interno ao carregar cursos.' });
  }
}
