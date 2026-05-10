// Deutsche Stopwort-Liste für Auto-Firma-Detection.
//
// Zweck: Verhindert, dass alltägliche deutsche Substantive/Adverbien fälschlich
// als Firma erkannt werden, wenn sie häufig in Blog-Posts auftauchen.
//
// Diese Liste ist absichtlich konservativ — lieber einen echten Firmennamen
// verpassen als 8000 Müll-Stubs anlegen.

export const GERMAN_STOPWORDS = new Set([
  // Konjunktionen / Adverbien (oft satzanfang → großgeschrieben in Listen)
  'aber','allerdings','also','außer','außerdem','beispielsweise','denn','deshalb','deswegen',
  'doch','ebenso','egal','endlich','etwa','erst','ferner','folglich','gleichzeitig','immer',
  'insbesondere','jedenfalls','jedoch','manchmal','mittlerweile','nachdem','natürlich','nicht',
  'nun','obwohl','oder','plötzlich','schließlich','selbst','sicher','sogar','sondern','sonst',
  'soweit','statt','tatsächlich','trotzdem','übrigens','und','vielleicht','während','weil',
  'weiter','weiterhin','wenn','wieder','wirklich','zudem','zumindest','zwar','zusätzlich',
  // Häufige Substantive (Allgemeinwortschatz)
  'abend','abendessen','abenteuer','abfolge','abfrage','abfragen','abgrund','abhängigkeit',
  'abhängigkeiten','abkürzung','abkürzungen','ablauf','ablehnung','ablenkung','ablenkungen',
  'absicht','abschied','abschluss','abstand','achtung','aktion','aktionen','aktivität','akzeptanz',
  'alarm','alltag','alter','analyse','anbieter','anfang','anfrage','angebot','angst','ankunft',
  'anleitung','anmeldung','annahme','antwort','antworten','anwendung','anwendungen','arbeit',
  'arbeiten','arbeiter','arbeitgeber','arbeitsplatz','art','artikel','asphalt','ass','aufgabe',
  'aufgaben','aufmerksamkeit','aufnahme','aufruf','auftrag','auftritt','auge','augen','ausblick',
  'ausdruck','ausgabe','ausgang','aussage','aussehen','austausch','auswahl','auswertung','auto',
  'bedeutung','bedingung','bedingungen','bedürfnis','befehl','befund','beginn','begriff',
  'beispiel','bemerkung','beobachtung','bereich','bereiche','bericht','beruf','beschreibung',
  'besitz','besprechung','bestellung','beweis','bewegung','beziehung','bild','bilder','bildschirm',
  'bisschen','bitte','blatt','blick','blog','boden','boom','brief','bruder','buch','büro',
  'chance','code','computer','daten','datum','dauer','deckung','denken','detail','dialog',
  'ding','dinge','dokument','dort','dose','dunkel','durchblick','durchgang','durchschnitt',
  'echo','ecke','eigenschaft','eindruck','einfluss','einführung','eingabe','einheit','einige',
  'einsatz','einstellung','element','ende','energie','entscheidung','entwicklung','ergebnis',
  'erfahrung','erfolg','erinnerung','erklärung','erlaubnis','ersatz','erste','erwartung',
  'erweiterung','erzeugung','euro','expert','experte','familie','fall','farbe','feedback',
  'fehler','feld','fenster','fest','feuer','figur','fläche','fluss','folge','form','foto',
  'frage','fragen','frau','freude','freund','funktion','furcht','fuß','gabe','gang','garten',
  'gas','gebäude','gebiet','gefahr','gefühl','gegenstand','gegenteil','geheimnis','geist',
  'geld','gelegenheit','gemeinschaft','genau','genuss','gerät','geräusch','gericht','gerücht',
  'gesamt','geschäft','geschichte','geschmack','gesicht','gespräch','gestalt','gestern','gesundheit',
  'gewicht','gewinn','gewohnheit','glauben','gleich','glück','gold','grad','grenze','größe',
  'grund','gruppe','haar','halt','haltung','hand','handel','hass','hauch','haus','heim','herd',
  'herr','herz','heute','hilfe','himmel','hinter','hinweis','hoffnung','höhe','hund','idee',
  'inhalt','interesse','inzwischen','jahr','jahre','journal','kabel','kaffee','kampf','kante',
  'kapitel','katze','kauf','kenntnis','kette','kind','kinder','klang','klasse','klick','klug',
  'körper','kopf','kraft','kreis','krieg','kugel','kunde','kunst','kurz','kurzer','land',
  'länge','last','laut','leben','leere','leistung','leiter','licht','lied','linie','linke',
  'liste','logik','lohn','lösung','luft','lust','macht','mag','magazin','mai','mail','mails',
  'mal','mangel','mann','marke','maß','master','material','mehr','mehrheit','meinung','mensch',
  'menschen','metall','methode','minute','mission','mittag','mittel','moment','monat','morgen',
  'motor','muster','mutter','nacht','nähe','name','natur','nebel','netz','neugier','neuigkeit',
  'nichts','niemand','niveau','norm','not','nuance','nutzen','oberfläche','objekt','oft','ohne',
  'ordnung','original','panik','papier','partei','partner','passwort','pause','peer','person',
  'pfad','pflicht','phase','platz','politik','position','post','potenzial','praxis','preis',
  'priorität','problem','produkt','prozess','punkt','qualität','quelle','rat','raum','reaktion',
  'recht','regel','region','reichweite','reihe','reise','rest','richtung','risiko','rolle',
  'ruhe','sache','satz','schaden','schatten','schau','schauen','schein','schicht','schicksal',
  'schiene','schiff','schluss','schmerz','schnitt','schock','schritt','schritte','schule',
  'schutz','schwäche','schwung','seele','seite','sektor','sicht','signal','sinn','situation',
  'skript','sofort','sohn','sonne','sorge','sound','spalt','spannung','speicher','sprache',
  'sprung','staat','stadt','stand','start','statistik','stein','stelle','stellung','stern',
  'stil','stille','stimme','stimmung','stoff','strafe','strom','stück','stunde','suche','sucht',
  'system','tabelle','tag','takt','teil','telefon','test','text','thema','tier','tisch','titel',
  'tochter','ton','tor','tot','traum','treffen','trend','trotz','tür','umfang','umgang',
  'umsatz','umwelt','unfall','unmut','unsicherheit','unterschied','urlaub','urteil','vater',
  'verfahren','vergleich','verhalten','verlust','verspätung','version','vertrag','verteilung',
  'vertrauen','video','volk','volumen','vorbild','vorgang','vorschlag','vorsicht','vorteil',
  'vorwurf','wahl','wahnsinn','wahrheit','wand','wärme','weg','welt','wende','werk','wert',
  'wesen','wetter','wichtig','widerstand','wille','wirkung','wirtschaft','wissen','wissenschaft',
  'witz','woche','wolke','wonne','wort','wunder','wunsch','würde','wut','zahl','zeit','zeile',
  'zentrum','zettel','zeug','ziel','ziele','ziffer','zorn','zukunft','zusatz','zustand','zweck',
  'zweifel','zwischen',
  // Englisch-Wortmüll (kommt häufig in Tech-Blog-Posts vor)
  'about','after','again','also','always','and','are','because','before','below','best','better',
  'between','both','can','case','cases','change','changes','click','code','coming','company',
  'companies','content','context','core','data','day','done','down','during','each','easy',
  'enough','even','every','example','few','few','first','form','found','from','full','get',
  'give','good','great','group','have','here','high','how','idea','if','important','into',
  'just','know','last','later','learn','left','less','let','life','like','look','make','many',
  'maybe','means','more','most','much','must','need','new','next','not','now','off','okay',
  'one','only','open','out','over','own','people','point','points','power','quick','really',
  'right','same','say','see','seems','set','setup','share','should','show','side','since','site',
  'small','some','start','still','stop','such','sure','take','team','teams','than','that','the',
  'their','them','then','there','these','this','those','time','today','top','total','two','use',
  'used','user','users','very','view','want','was','way','well','were','what','when','where',
  'which','while','who','whose','why','will','with','without','work','works','would','year',
  'years','yes','you','your',
  // Markup/Format-Wortmüll
  'wikilinks','wikilink','frontmatter','backlink','metadata','readme'
])

/**
 * Prüft ob ein Name (oder das erste Token eines Mehrwort-Namens) ein deutsches
 * Allerweltswort ist und damit als Firma ausgeschlossen werden sollte.
 *
 * Mehrwort-Namen wie "Aber Apple" werden ebenfalls aussortiert, weil das erste
 * Token ("Aber") schon Müll ist — echte Firmennamen starten nicht mit Konjunktionen.
 */
export function isGermanStopword(name) {
  const t = String(name || '').trim().toLowerCase()
  if (!t) return false
  if (GERMAN_STOPWORDS.has(t)) return true
  // Mehrwort: erstes Token entscheidet
  const first = t.split(/\s+/)[0]
  if (first !== t && GERMAN_STOPWORDS.has(first)) return true
  return false
}
