export interface SettingsAuditEvent {
  actor: string;
  action: string;
  target?: string;
  fields?: string[];
}

// Only actor, action, target and field names belong in settings audit events.
export const logSettingsChange = (event: SettingsAuditEvent): void => {
  const { actor, action, target, fields } = event;
  console.log('[Settings]', JSON.stringify({ actor, action, target, fields }));
};
