"""Simple fund analytics helpers for future Python-side prediction work."""

from __future__ import annotations

from math import sqrt


def calculate_change(previous_price: float, current_price: float) -> float:
    if previous_price <= 0:
        return 0.0
    change = (current_price - previous_price) / previous_price * 100
    return round(change, 2)


def moving_average(values: list[float], period: int) -> float:
    if not values or period <= 0:
        return 0.0
    window = values[-period:]
    return sum(window) / len(window)


def daily_returns(values: list[float]) -> list[float]:
    returns: list[float] = []
    for index in range(1, len(values)):
        previous = values[index - 1]
        current = values[index]
        if previous > 0:
            returns.append((current - previous) / previous)
    return returns


def volatility(values: list[float]) -> float:
    returns = daily_returns(values)
    if not returns:
        return 0.0

    avg = sum(returns) / len(returns)
    variance = sum((item - avg) ** 2 for item in returns) / len(returns)
    return sqrt(variance) * 100


def linear_regression_forecast(values: list[float], future_days: int = 5) -> list[float]:
    if not values:
        return []
    if len(values) == 1:
        return [values[0]] * future_days

    count = len(values)
    xs = list(range(count))
    sum_x = sum(xs)
    sum_y = sum(values)
    sum_xy = sum(x * y for x, y in zip(xs, values))
    sum_xx = sum(x * x for x in xs)

    denominator = count * sum_xx - sum_x * sum_x
    slope = 0.0 if denominator == 0 else (count * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / count

    forecast = []
    for step in range(future_days):
        predicted = intercept + slope * (count + step)
        forecast.append(round(max(predicted, 0.0), 4))
    return forecast


def build_prediction(values: list[float]) -> dict[str, float | str | list[float]]:
    recent_values = values[-20:]
    if len(recent_values) < 2:
        return {
            "latest_nav": recent_values[-1] if recent_values else 0.0,
            "ma5": 0.0,
            "ma10": 0.0,
            "momentum": 0.0,
            "volatility": 0.0,
            "predicted_nav": recent_values[-1] if recent_values else 0.0,
            "confidence": 25.0,
            "trend_label": "样本不足",
            "forecast_values": recent_values,
        }

    latest_nav = recent_values[-1]
    ma5 = moving_average(recent_values, min(5, len(recent_values)))
    ma10 = moving_average(recent_values, min(10, len(recent_values)))
    momentum_base = recent_values[-6] if len(recent_values) > 5 else recent_values[0]
    momentum = calculate_change(momentum_base, latest_nav) if momentum_base > 0 else 0.0
    vol = volatility(recent_values)
    forecast_values = linear_regression_forecast(recent_values, future_days=5)
    predicted_nav = forecast_values[-1] if forecast_values else latest_nav
    confidence = max(25.0, min(88.0, 90.0 - vol * 6))

    trend_label = "震荡"
    if ma5 > ma10 and momentum > 0:
        trend_label = "偏强"
    elif ma5 < ma10 and momentum < 0:
        trend_label = "偏弱"

    return {
        "latest_nav": round(latest_nav, 4),
        "ma5": round(ma5, 4),
        "ma10": round(ma10, 4),
        "momentum": round(momentum, 2),
        "volatility": round(vol, 2),
        "predicted_nav": round(predicted_nav, 4),
        "confidence": round(confidence, 2),
        "trend_label": trend_label,
        "forecast_values": forecast_values,
    }
