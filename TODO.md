# Przyszły rozwój bota (TODO)

Lista zaawansowanych funkcji i usprawnień do potencjalnego wdrożenia w przyszłości:

## 1. System anty-Cloudflare (Bypass zabezpieczeń)
- Wdrożenie zaawansowanych wtyczek typu `playwright-stealth`.
- Omijanie kolejek (waiting rooms) oraz ekranów weryfikacji przeglądarki (Cloudflare Turnstile, Datadome).
- Zastosowanie do bardzo agresywnie chronionych dropów na dużych sklepach.

## 2. Klucz API do płatności (W pełni zautomatyzowany zakup)
- Integracja z wirtualnymi kartami płatniczymi (np. Revolut).
- Automatyczne przepisywanie danych karty i zamykanie transakcji bez jakiejkolwiek ingerencji użytkownika.
- Alternatywnie: automatyczne odbieranie i przepisywanie kodu BLIK z API/zewnętrznego serwera.

## 3. Wsparcie dla wielu zakładek naraz (Clustering)
- Przejście na architekturę `playwright-cluster` (lub worker threads).
- Umożliwienie równoległego działania wielu instancji przeglądarek bez spadku wydajności głównego procesu.
- Idealne rozwiązanie do jednoczesnego polowania na kilkanaście produktów w kilku różnych sklepach w tej samej sekundzie (tzw. massive drops).
