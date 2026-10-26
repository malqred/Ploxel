export interface GuideSection {
  heading: string;
  text?: string;
  steps?: string[];
  note?: string;
}

export interface Guide {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  icon: string;
  minutes: number;
  sections: GuideSection[];
}