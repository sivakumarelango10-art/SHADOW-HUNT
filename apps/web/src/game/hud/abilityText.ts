export function abilityText(id: string) {
  switch (id) {
    case 'shadow_step':
      return 'Q — Shadow Step: blink to a nearby shadow you are looking at.';
    case 'brutal_charge':
      return 'Q — Brutal Charge: barrel forward; walls will stun you.';
    case 'echo_sense':
      return 'Q — Echo Sense: reveal survivors who are moving nearby.';
    default:
      return '';
  }
}
