module.exports = {
  appId: 'at.promptrocker.vinci',
  productName: 'VINCI',
  copyright: '© 2026 Alex Januschewsky / Prompt Rocker',
  mac: {
    category:         'public.app-category.productivity',
    target:           [{ target: 'dmg', arch: ['arm64'] }],
    icon:             'assets/icon.icns',
    hardenedRuntime:  false,
    gatekeeperAssess: false,
    darkModeSupport:  true,
    extendInfo: {
      LSUIElement: 1,
      NSCalendarsUsageDescription:           'VINCI liest deine Termine, um dich an Meetings zu erinnern und Briefings zu erstellen.',
      NSCalendarsFullAccessUsageDescription: 'VINCI liest deine Termine, um dich an Meetings zu erinnern und Briefings zu erstellen.',
      NSRemindersUsageDescription:           'VINCI liest und erstellt Erinnerungen.',
      NSRemindersFullAccessUsageDescription: 'VINCI liest und erstellt Erinnerungen.',
      NSContactsUsageDescription:            'VINCI verknüpft Termine und E-Mails mit Kontakten.',
      NSAppleEventsUsageDescription:         'VINCI steuert Mail, Kalender und Erinnerungen über AppleScript.',
      NSMicrophoneUsageDescription:          'VINCI nimmt deine Sprachbefehle für Push-to-Talk auf.',
      NSSystemAdministrationUsageDescription:'VINCI führt Helfer-Skripte (icalBuddy) aus, um Kalenderdaten zu lesen.'
    }
  },
  dmg: {
    title:  'VINCI – Personal AI Assistant',
    window: { width: 540, height: 380 }
  },
  files: ['out/**/*'],
  // Assets OUTSIDE asar so file:// URLs work
  extraResources: [
    { from: 'assets/', to: 'assets/' }
  ],
  directories: { output: 'release' }
}
