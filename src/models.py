from dataclasses import dataclass, asdict
from typing import Optional

@dataclass
class Listing:
    building_name: str
    location: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    dist_km: Optional[float] = None
    area_m2: Optional[float] = None
    available_from: str = "N/D"
    rent_eur_m2_month: Optional[float] = None
    rent_range_note: str = ""
    community_eur_month: Optional[float] = None
    community_is_estimated: bool = False
    ibi_eur_month: Optional[float] = None
    ibi_is_estimated: bool = False
    source_url: str = ""
    consulted_on: str = ""
    score: float = 0.0
    notes: str = ""

    def to_dict(self):
        return asdict(self)
