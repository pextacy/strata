// Every route in one place, inside one frame.
//
// `Shell` is a layout route rather than something each page remembers to import,
// so the header, the footer, the skip link and BasePaint's beacon exist on every
// page by construction — including the one that says a URL does not exist.

import { Route, Routes } from "react-router-dom";

import Artist from "./routes/Artist.tsx";
import Day from "./routes/Day.tsx";
import Home from "./routes/Home.tsx";
import NotFound from "./routes/NotFound.tsx";
import { Shell } from "./ui/Shell.tsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        {/* Today's canvas, live. Most first-time visitors land here. */}
        <Route path="/" element={<Home />} />
        <Route path="/day/:day" element={<Day />} />
        <Route path="/artist/:address" element={<Artist />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
