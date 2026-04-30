import { DailyDigest } from '../DailyDigest';

export default function Preview() {
  return (
    <DailyDigest
      displayName="Ethan"
      todayShows={[
        {
          headliner: 'Hadestown',
          venueName: 'Walter Kerr Theatre',
          seat: 'Orch G 14',
        },
      ]}
      upcomingShows={[
        {
          headliner: 'Caroline Polachek',
          venueName: 'Brooklyn Steel',
          dateLabel: 'Sat, May 3',
          daysUntil: 3,
        },
        {
          headliner: 'The Cure',
          venueName: 'Madison Square Garden',
          dateLabel: 'Wed, May 7',
          daysUntil: 7,
        },
      ]}
      newAnnouncements={[
        {
          headliner: 'Phoebe Bridgers',
          venueName: 'Forest Hills Stadium',
          whenLabel: 'Aug 15',
          reason: 'artist',
          onSaleSoon: true,
        },
        {
          headliner: 'Sufjan Stevens',
          venueName: 'Kings Theatre',
          whenLabel: 'Sep 12 – Sep 14 (3 dates)',
          reason: 'venue',
          onSaleSoon: false,
        },
      ]}
      appUrl="https://showbook.local"
    />
  );
}
