"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
export default function LocationMap({
  locations,
}: {
  locations: Record<string, any>[];
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const first = locations[0],
      map = L.map(host.current).setView(
        first ? [first.latitude, first.longitude] : [0, 0],
        first ? 14 : 2,
      );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    for (const l of locations) {
      const label = document.createElement("span");
      label.textContent = l.address;
      L.marker([l.latitude, l.longitude], {
        icon: L.divIcon({
          className: "map-pin",
          html: "●",
          iconSize: [22, 22],
        }),
      })
        .addTo(map)
        .bindPopup(label);
    }
    return () => {
      map.remove();
    };
  }, [locations]);
  return (
    <div
      ref={host}
      className="location-map"
      aria-label="OpenStreetMap locations"
    />
  );
}
