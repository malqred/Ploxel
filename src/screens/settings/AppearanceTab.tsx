import { AccentSection, BackgroundSection, ThemeSection } from './AppearanceSections';
import { LayoutSection, MotionSection, TypographySection } from './TypographySections';

export function AppearanceTab() {
  return (
    <>
      <ThemeSection />
      <AccentSection />
      <BackgroundSection />
      <TypographySection />
      <MotionSection />
      <LayoutSection />
    </>
  );
}