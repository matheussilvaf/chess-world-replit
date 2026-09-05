import type { SkillId } from '../../shared/progress/EnergySkillsShapes';

/** Habilidades que existem no personagem mas ainda não têm forma de ganhar XP. */
export const SKILL_NOTES: Partial<Record<SkillId, string>> = {
  hunting: 'Em breve',
  alchemy: 'Em breve',
  trading: 'Em breve',
};
