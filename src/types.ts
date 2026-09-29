// Represents a physical growing tray.
export type Tray = {
  id: string;
  code: string;
  zone: string;
  capacity_units: number;
  created_at: string;
};

// Represents a crop batch tracked inside a tray.
export type Batch = {
  id: string;
  tray_id: string;
  crop: string;
  seeded_on: string;
  stage: string;
  expected_harvest_on: string;
};