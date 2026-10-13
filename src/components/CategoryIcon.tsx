import {
  Baby,
  BookOpen,
  Briefcase,
  Dumbbell,
  KeyRound,
  Package,
  PawPrint,
  Shirt,
  Smartphone,
  Sofa,
  TabletSmartphone,
  Wallet,
  Watch,
} from 'lucide-react';

// Icons are referenced by name in the DB (categories.icon) and resolved here (static map).
const ICONS = {
  smartphone: Smartphone,
  'tablet-smartphone': TabletSmartphone,
  'key-round': KeyRound,
  wallet: Wallet,
  briefcase: Briefcase,
  watch: Watch,
  shirt: Shirt,
  sofa: Sofa,
  baby: Baby,
  'book-open': BookOpen,
  dumbbell: Dumbbell,
  'paw-print': PawPrint,
  package: Package,
} as const;

export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  const key = (name ?? 'package') as keyof typeof ICONS;
  const C = ICONS[key] ?? Package;
  return <C className={className} aria-hidden />;
}
