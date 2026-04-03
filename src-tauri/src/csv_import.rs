use crate::{
    domain::{CsvImportRow, MarginMode, PositionSide},
    error::{invalid_input, AppResult},
};

pub struct ParsedCsvRow {
    pub row_number: usize,
    pub data: CsvImportRow,
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        match chars[index] {
            '"' if in_quotes && chars.get(index + 1) == Some(&'"') => {
                current.push('"');
                index += 1;
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                values.push(current.trim().to_string());
                current.clear();
            }
            character => current.push(character),
        }

        index += 1;
    }

    values.push(current.trim().to_string());
    values
}

fn parse_side(raw: &str) -> AppResult<PositionSide> {
    match raw.trim().to_lowercase().as_str() {
        "long" | "buy" => Ok(PositionSide::Long),
        "short" | "sell" => Ok(PositionSide::Short),
        other => Err(invalid_input(format!("unsupported side `{other}`"))),
    }
}

fn parse_margin_mode(raw: Option<&&String>) -> AppResult<Option<MarginMode>> {
    let Some(value) = raw.map(|item| item.trim()).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };

    match value.to_lowercase().as_str() {
        "cross" => Ok(Some(MarginMode::Cross)),
        "isolated" | "isolate" => Ok(Some(MarginMode::Isolated)),
        other => Err(invalid_input(format!("unsupported margin_mode `{other}`"))),
    }
}

fn parse_number(raw: Option<&&String>) -> f64 {
    raw.and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn parse_optional_positive_number(raw: Option<&&String>) -> AppResult<Option<f64>> {
    let Some(value) = raw.map(|item| item.trim()).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };
    let parsed = value
        .parse::<f64>()
        .map_err(|_| invalid_input(format!("invalid numeric value `{value}`")))?;
    if parsed <= 0.0 {
        return Err(invalid_input(format!(
            "expected a positive numeric value, got `{value}`"
        )));
    }
    Ok(Some(parsed))
}

fn parse_optional_non_negative_number(raw: Option<&&String>) -> AppResult<Option<f64>> {
    let Some(value) = raw.map(|item| item.trim()).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };
    let parsed = value
        .parse::<f64>()
        .map_err(|_| invalid_input(format!("invalid numeric value `{value}`")))?;
    if parsed < 0.0 {
        return Err(invalid_input(format!(
            "expected a non-negative numeric value, got `{value}`"
        )));
    }
    Ok(Some(parsed))
}

pub fn parse_csv(payload: &str) -> AppResult<(Vec<ParsedCsvRow>, Vec<String>)> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err(invalid_input("csv payload is empty"));
    }

    let mut lines = trimmed.lines().filter(|line| !line.trim().is_empty());
    let header_line = lines
        .next()
        .ok_or_else(|| invalid_input("missing header row"))?;
    let headers = parse_csv_line(header_line)
        .into_iter()
        .map(|header| header.trim().to_lowercase())
        .collect::<Vec<_>>();

    let mut accepted = Vec::new();
    let mut rejected = Vec::new();

    for (line_index, line) in lines.enumerate() {
        let values = parse_csv_line(line);

        let lookup = headers
            .iter()
            .enumerate()
            .filter_map(|(index, header)| values.get(index).map(|value| (header.as_str(), value)))
            .collect::<std::collections::HashMap<_, _>>();

        let row_number = line_index + 2;
        let parse_result = (|| -> AppResult<CsvImportRow> {
            let exchange_symbol = lookup
                .get("exchange_symbol")
                .map(|value| value.trim().to_uppercase())
                .filter(|value| !value.is_empty());
            let symbol = lookup
                .get("symbol")
                .map(|value| value.trim().to_uppercase())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid_input("missing symbol"))?;

            let entry_price = parse_number(lookup.get("entry_price"));
            let quantity = parse_number(lookup.get("quantity"));
            if entry_price <= 0.0 || quantity <= 0.0 {
                return Err(invalid_input("entry_price and quantity must be positive"));
            }

            Ok(CsvImportRow {
                exchange_symbol,
                symbol,
                margin_mode: parse_margin_mode(lookup.get("margin_mode"))?,
                side: parse_side(lookup.get("side").map_or("", |value| value.as_str()))?,
                entry_price,
                quantity,
                leverage: parse_number(lookup.get("leverage")).max(1.0),
                mark_price: {
                    let mark = parse_number(lookup.get("mark_price"));
                    (mark > 0.0).then_some(mark)
                },
                margin_used: parse_optional_non_negative_number(lookup.get("margin_used"))?,
                liquidation_price: parse_optional_positive_number(lookup.get("liquidation_price"))?,
                maintenance_margin: parse_optional_non_negative_number(
                    lookup.get("maintenance_margin"),
                )?,
                realized_pnl: parse_number(lookup.get("realized_pnl")),
                fee_paid: parse_number(lookup.get("fee_paid")),
                funding_paid: parse_number(lookup.get("funding_paid")),
            })
        })();

        match parse_result {
            Ok(row) => accepted.push(ParsedCsvRow {
                row_number,
                data: row,
            }),
            Err(error) => rejected.push(format!("row {row_number}: {error}")),
        }
    }

    Ok((accepted, rejected))
}

#[cfg(test)]
mod tests {
    use super::parse_csv;
    use crate::domain::MarginMode;

    #[test]
    fn parses_valid_rows_and_rejects_invalid_rows() {
        let payload = [
            "symbol,side,entry_price,quantity,leverage,mark_price",
            "BTCUSDT,long,100,1,5,101",
            "ETHUSDT,sell,0,1,2,",
        ]
        .join("\n");

        let (rows, rejected) = parse_csv(&payload).expect("csv should parse");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].row_number, 2);
        assert_eq!(rows[0].data.symbol, "BTCUSDT");
        assert_eq!(rejected.len(), 1);
    }

    #[test]
    fn parses_optional_live_parity_columns() {
        let payload = [
            "symbol,exchange_symbol,margin_mode,side,entry_price,quantity,leverage,mark_price,margin_used,liquidation_price,maintenance_margin,realized_pnl,fee_paid,funding_paid",
            "BTC-PERP,BTC-USDT,cross,long,100,1,5,101,20,80,1.5,4.2,0.5,0.2",
        ]
        .join("\n");

        let (rows, rejected) = parse_csv(&payload).expect("csv should parse");
        assert!(rejected.is_empty());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].data.exchange_symbol.as_deref(), Some("BTC-USDT"));
        assert_eq!(rows[0].data.margin_mode, Some(MarginMode::Cross));
        assert_eq!(rows[0].data.margin_used, Some(20.0));
        assert_eq!(rows[0].data.liquidation_price, Some(80.0));
        assert_eq!(rows[0].data.maintenance_margin, Some(1.5));
        assert_eq!(rows[0].data.realized_pnl, 4.2);
    }
}
