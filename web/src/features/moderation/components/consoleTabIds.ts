export type ConsoleTab = 'photos' | 'messages'

export const tabId = (tab: ConsoleTab): string => `moderation-tab-${tab}`
export const panelId = (tab: ConsoleTab): string => `moderation-panel-${tab}`
