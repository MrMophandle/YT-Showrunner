import { Navigate, Route, Routes } from "react-router-dom";
import { SeasonChat } from "./pages/SeasonChat.js";

export function App() {
  return (
    <Routes>
      <Route path="/seasons/:seasonId/chat" element={<SeasonChat />} />
      {/* Season selection/management is out of scope for this task — a
          direct URL to a season's chat is the supported entry point. */}
      <Route path="*" element={<Navigate to="/seasons/season-1/chat" replace />} />
    </Routes>
  );
}
