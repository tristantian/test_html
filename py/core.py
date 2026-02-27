# core.py

def calculate_change(previous_price, current_price):
    change = (current_price - previous_price) / previous_price * 100
    return round(change, 2)