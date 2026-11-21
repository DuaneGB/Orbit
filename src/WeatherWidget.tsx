import { useState } from "react";

type WeatherSummary = {
  temperature: number;
  feelsLike: number;
  description: string;
};

function describeWeather(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Current conditions";
}

function parseWeatherPayload(value: unknown): WeatherSummary | null {
  if (typeof value !== "object" || value === null || !("current" in value)) return null;
  const current = value.current;
  if (typeof current !== "object" || current === null) return null;
  if (
    !("temperature_2m" in current) ||
    !("apparent_temperature" in current) ||
    !("weather_code" in current) ||
    typeof current.temperature_2m !== "number" ||
    typeof current.apparent_temperature !== "number" ||
    typeof current.weather_code !== "number"
  ) return null;
  return {
    temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature,
    description: describeWeather(current.weather_code),
  };
}

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadWeather(position: GeolocationPosition) {
    const parameters = new URLSearchParams({
      latitude: String(position.coords.latitude),
      longitude: String(position.coords.longitude),
      current: "temperature_2m,apparent_temperature,weather_code",
      temperature_unit: "celsius",
      timezone: "auto",
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`);
      if (!response.ok) throw new Error("The weather service is unavailable right now.");
      const payload: unknown = await response.json();
      const current = parseWeatherPayload(payload);
      if (!current) throw new Error("The weather service returned an unexpected response.");
      setWeather(current);
      setError("");
    } catch (loadError) {
      console.error("Could not load local weather.", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load local weather.");
    } finally {
      setLoading(false);
    }
  }

  function requestWeather() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location access is not available in this browser.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { void loadWeather(position); },
      (locationError) => {
        setLoading(false);
        setError(locationError.code === locationError.PERMISSION_DENIED
          ? "Location permission was denied. Allow it in your browser settings to see local weather."
          : locationError.code === locationError.TIMEOUT
            ? "Location lookup timed out. Try again."
            : "Your location could not be determined. Try again.");
      },
      { enableHighAccuracy: false, maximumAge: 15 * 60 * 1000, timeout: 10_000 },
    );
  }

  return (
    <article aria-live="polite" className="today-widget weather-widget">
      <div className="today-widget-top"><span>LOCAL WEATHER</span><span className="weather-widget-mark" aria-hidden="true">°</span></div>
      {weather ? (
        <div className="weather-widget-result">
          <strong>{Math.round(weather.temperature)}°C</strong>
          <span>{weather.description}</span>
          <small>Feels like {Math.round(weather.feelsLike)}°C · Your location</small>
        </div>
      ) : (
        <div className="weather-widget-prompt">
          <strong>{loading ? "Finding your weather…" : "Weather near you"}</strong>
          {error && <span className="weather-widget-error" role="alert">{error}</span>}
          <button disabled={loading} onClick={requestWeather} type="button">
            {loading ? "Checking location…" : "Use my location"}
          </button>
        </div>
      )}
      <small className="weather-widget-privacy">Your location is sent to Open-Meteo for the forecast.</small>
    </article>
  );
}
