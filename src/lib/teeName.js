import { t } from '../i18n';

// Courses seeded before tees existed carry one placeholder tee literally named
// "Default". Show that one in the active language; every other tee name is
// course data and stays as written. Display only: never store the result.
// Finished text in the language active now: call it at render time.
export function teeDisplayName(label) {
  if (label == null) return label;
  return String(label).trim().toLowerCase() === 'default' ? t('shared.tees.defaultTee') : label;
}
