"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

export default function MapPageView() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}
