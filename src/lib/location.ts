"use client";

import type { LocationInfo } from "./vault";

export interface GeolocationResult {
  success: boolean;
  location?: LocationInfo;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  error?: string;
}

/**
 * Checks if geolocation is supported by the browser
 */
export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Gets the current position from the browser's Geolocation API
 */
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000, // Cache for 1 minute
    });
  });
}

/**
 * Reverse geocodes coordinates to address using Nominatim (OpenStreetMap)
 */
async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<LocationInfo> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          "User-Agent": "ob-share/1.0 (https://ob-share.up.railway.app)",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = await response.json();
    const address = data.address || {};

    // Extract location parts from the response
    // Nominatim returns various fields depending on the location
    const country = address.country;
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county;
    const area =
      address.suburb ||
      address.neighbourhood ||
      address.quarter ||
      address.district;
    const street = address.road || address.street;

    return {
      country,
      city,
      area,
      street,
    };
  } catch (error) {
    // If geocoding fails, return undefined to trigger GPS coordinate fallback
    console.error("Reverse geocoding failed:", error);
    throw error;
  }
}

/**
 * Formats GPS coordinates as a fallback location string
 */
function formatCoordinates(latitude: number, longitude: number): string {
  const latDir = latitude >= 0 ? "N" : "S";
  const lonDir = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(4)}°${latDir}, ${Math.abs(longitude).toFixed(4)}°${lonDir}`;
}

/**
 * Gets the user's current location with reverse geocoding
 * Falls back to GPS coordinates if geocoding fails
 */
export async function getLocation(): Promise<GeolocationResult> {
  if (!isGeolocationSupported()) {
    return {
      success: false,
      error: "Geolocation is not supported by this browser",
    };
  }

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;

    try {
      // Try to reverse geocode the coordinates
      const location = await reverseGeocode(latitude, longitude);

      // If we couldn't get any area info, use GPS coordinates for area
      if (!location.area && !location.street) {
        location.area = formatCoordinates(latitude, longitude);
      }

      return {
        success: true,
        location,
        coordinates: { latitude, longitude },
      };
    } catch {
      // If reverse geocoding fails, use GPS coordinates
      return {
        success: true,
        location: {
          area: formatCoordinates(latitude, longitude),
        },
        coordinates: { latitude, longitude },
      };
    }
  } catch (error) {
    const geoError = error as GeolocationPositionError;

    let errorMessage: string;
    switch (geoError.code) {
      case geoError.PERMISSION_DENIED:
        errorMessage = "Location permission was denied";
        break;
      case geoError.POSITION_UNAVAILABLE:
        errorMessage = "Location information is unavailable";
        break;
      case geoError.TIMEOUT:
        errorMessage = "Location request timed out";
        break;
      default:
        errorMessage = geoError.message || "Failed to get location";
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Requests location permission from the browser
 * Returns true if permission is granted, false if denied
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (!isGeolocationSupported()) {
    return false;
  }

  try {
    // Try to get current position - this triggers the permission prompt
    await getCurrentPosition();
    return true;
  } catch (error) {
    const geoError = error as GeolocationPositionError;
    // PERMISSION_DENIED = 1
    if (geoError.code === 1) {
      return false;
    }
    // Other errors (like timeout) still mean permission might have been granted
    // so we'll try again on the actual share
    return true;
  }
}

/**
 * Checks the current location permission status using the Permissions API
 * Note: Not all browsers support this, so we fall back to unknown
 */
export async function checkLocationPermission(): Promise<
  "granted" | "denied" | "prompt" | "unknown"
> {
  if (!isGeolocationSupported()) {
    return "denied";
  }

  try {
    if ("permissions" in navigator) {
      const result = await navigator.permissions.query({ name: "geolocation" });
      return result.state as "granted" | "denied" | "prompt";
    }
  } catch {
    // Permissions API not supported
  }

  return "unknown";
}
