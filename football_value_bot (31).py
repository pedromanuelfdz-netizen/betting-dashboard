import requests
import time
from scipy.stats import poisson
import json
from datetime import datetime, timezone, timedelta
import os
import math
import numpy as np
from scipy.optimize import minimize
import csv
import hashlib
import subprocess
import re

# ============================================================================
# XGBOOST PREDICTOR - INLINE (sin archivos externos)
# Integrado directamente en el bot para evitar dependencias externas
# ============================================================================
try:
    import xgboost as xgb
    from sklearn.model_selection import TimeSeriesSplit
    XGB_AVAILABLE = True
    print("[INIT] XGBoost disponible ✅")
except ImportError:
    XGB_AVAILABLE = False
    print("[INIT] XGBoost no disponible, funcionando solo con Dixon-Coles")

# Configuración XGBoost
ENABLE_XGBOOST = True   # Cambiar a False para desactivar completamente
XGBOOST_WEIGHT = 0.25   # Peso de XGBoost (0.25 = 75% DC + 25% XGB, conservador)

# Configuración Filtro de Consenso DC vs XGBoost
ENABLE_CONSENSUS_FILTER = True   # Filtro de consenso (mejora ~+2 puntos ROI)
CONSENSUS_THRESHOLD = 0.15       # Max diferencia permitida (15% = 0.15)

class AdvancedXGBPredictor:
    """
    XGBoost V4 con mejoras:
    1. Match-level training (partidos históricos en lugar de team-level)
    2. BTTS prediction (además de Over/Under)
    3. Peso dinámico adaptativo (auto-optimización)
    """
    
    def __init__(self):
        # Modelos
        self.model_over = None
        self.model_under = None
        self.model_btts_yes = None
        self.model_btts_no = None
        self.trained = False
        
        # Peso adaptativo
        self.adaptive_weight = XGBOOST_WEIGHT  # Comienza con valor configurado
        self.weight_history = []  # Track de pesos históricos
        
        # Performance tracking para peso adaptativo
        self.predictions_dc = []  # [(prob_dc, result), ...]
        self.predictions_xgb = []  # [(prob_xgb, result), ...]
        self.window_size = 50  # Evaluar cada 50 picks
        
        # Match-level historical data
        self.historical_matches = []  # Guardará partidos históricos
        self.historical_fixtures = []  # Para features en producción (H2H, Forma)
        
        # Fallback tracking (V4.2.1)
        self.fallback_count = 0
        self.fallback_reasons = []
        
    def add_prediction_for_tracking(self, prob_dc, prob_xgb, result):
        """
        Guardar predicción para cálculo de Brier score
        
        Args:
            prob_dc: Probabilidad predicha por Dixon-Coles (0-100)
            prob_xgb: Probabilidad predicha por XGBoost (0-100)
            result: Resultado real (1 si Over/BTTS-Yes, 0 si Under/BTTS-No)
        """
        self.predictions_dc.append((prob_dc / 100.0, result))
        self.predictions_xgb.append((prob_xgb / 100.0, result))
        
        # Ajustar peso cada window_size predicciones
        if len(self.predictions_dc) >= self.window_size:
            self._adjust_adaptive_weight()
    
    def _calculate_brier_score(self, predictions):
        """Calcular Brier score de predicciones recientes"""
        if not predictions:
            return None
        
        recent = predictions[-self.window_size:]
        scores = [(prob - result) ** 2 for prob, result in recent]
        return np.mean(scores)
    
    def _adjust_adaptive_weight(self):
        """Ajustar peso basado en performance reciente"""
        brier_dc = self._calculate_brier_score(self.predictions_dc)
        brier_xgb = self._calculate_brier_score(self.predictions_xgb)
        
        if brier_dc is None or brier_xgb is None:
            return
        
        print(f"[XGB-ADAPT] Brier Score - DC: {brier_dc:.4f}, XGB: {brier_xgb:.4f}")
        
        # Ajustar peso
        old_weight = self.adaptive_weight
        
        if brier_xgb < brier_dc:
            # XGBoost funciona mejor, aumentar peso
            self.adaptive_weight = min(self.adaptive_weight + 0.05, 0.40)
            action = "↑"
        else:
            # Dixon-Coles funciona mejor, reducir peso XGB
            self.adaptive_weight = max(self.adaptive_weight - 0.05, 0.15)
            action = "↓"
        
        self.weight_history.append(self.adaptive_weight)
        
        print(f"[XGB-ADAPT] Peso ajustado: {old_weight:.2f} → {self.adaptive_weight:.2f} {action}")
        
        # Limpiar predicciones antiguas para no consumir memoria
        if len(self.predictions_dc) > self.window_size * 2:
            self.predictions_dc = self.predictions_dc[-self.window_size:]
            self.predictions_xgb = self.predictions_xgb[-self.window_size:]
    
    # ════════════════════════════════════════════════════════════════════
    # V4.2: HELPER METHODS - FORMA EMA Y H2H REAL
    # ════════════════════════════════════════════════════════════════════
    
    def _calculate_form_ema(self, recent_results, alpha=0.3):
        """
        Calcula forma con Exponential Moving Average.
        Partidos recientes pesan más que antiguos.
        
        Args:
            recent_results: Lista de resultados [W, L, D, W, ...] o [1.0, 0.0, 0.5, ...]
            alpha: Factor de decaimiento (0.3 = 30% peso al más reciente)
        
        Returns:
            Float entre 0.0 y 1.0 (forma del equipo)
        """
        if not recent_results:
            return 0.5  # Default neutral
        
        # Convertir a scores numéricos si es necesario
        scores = []
        for r in recent_results:
            if isinstance(r, str):
                if r == 'W':
                    scores.append(1.0)
                elif r == 'D':
                    scores.append(0.5)
                elif r == 'L':
                    scores.append(0.0)
                else:
                    scores.append(0.5)
            else:
                scores.append(float(r))
        
        # Calcular pesos EMA (más reciente pesa más)
        weights = [alpha * (1 - alpha)**i for i in range(len(scores))]
        weights = weights[::-1]  # Invertir: primeros pesan menos
        
        # Media ponderada
        weighted_sum = sum(s * w for s, w in zip(scores, weights))
        total_weight = sum(weights)
        
        return weighted_sum / total_weight if total_weight > 0 else 0.5
    
    def _extract_h2h_from_historicals(self, home_id, away_id, max_matches=5):
        """
        Extrae estadísticas H2H reales de partidos históricos.
        
        Args:
            home_id: ID equipo local
            away_id: ID equipo visitante
            max_matches: Máximo número de H2H a considerar
        
        Returns:
            (goals_avg, btts_rate): Tupla con goles promedio y tasa BTTS
        """
        if not self.historical_fixtures:
            return 2.5, 0.5  # Defaults si no hay históricos
        
        # Buscar H2H (cualquier orden)
        h2h_matches = []
        for match in self.historical_fixtures:
            if ((match['home_id'] == home_id and match['away_id'] == away_id) or
                (match['home_id'] == away_id and match['away_id'] == home_id)):
                h2h_matches.append(match)
        
        if len(h2h_matches) < 2:
            return 2.5, 0.5  # Muy pocos H2H, usar defaults
        
        # Últimos N enfrentamientos
        recent_h2h = sorted(h2h_matches, key=lambda x: x['date'])[-max_matches:]
        
        # Calcular stats
        total_goals = []
        btts_count = 0
        
        for match in recent_h2h:
            home_goals = match.get('home_goals', 0)
            away_goals = match.get('away_goals', 0)
            
            total_goals.append(home_goals + away_goals)
            
            if home_goals > 0 and away_goals > 0:
                btts_count += 1
        
        goals_avg = np.mean(total_goals) if total_goals else 2.5
        btts_rate = btts_count / len(recent_h2h) if recent_h2h else 0.5
        
        return float(goals_avg), float(btts_rate)
    
    def _log_fallback(self, reason, match_info=""):
        """
        Registra un fallback a Dixon-Coles.
        
        Args:
            reason: Razón del fallback
            match_info: Info opcional del partido
        """
        self.fallback_count += 1
        self.fallback_reasons.append({
            'timestamp': datetime.now().isoformat(),
            'reason': reason,
            'match': match_info
        })
        
        print(f"[FALLBACK] {reason} → usando Dixon-Coles solo")
        
        # Alertar si demasiados fallbacks
        if self.fallback_count >= 5:
            print(f"[FALLBACK] ⚠️ ALERTA: {self.fallback_count} fallbacks detectados")
    
    def get_fallback_summary(self):
        """
        Obtiene resumen de fallbacks.
        
        Returns:
            String con resumen
        """
        if not self.fallback_reasons:
            return "✅ Sin fallbacks"
        
        # Contar razones
        reasons_count = {}
        for fb in self.fallback_reasons:
            r = fb['reason']
            reasons_count[r] = reasons_count.get(r, 0) + 1
        
        summary = f"⚠️ {self.fallback_count} fallbacks:\n"
        for reason, count in reasons_count.items():
            summary += f"  • {reason}: {count}\n"
        
        return summary
    
    # ════════════════════════════════════════════════════════════════════
    
    def train_match_level(self, fixtures_historical):
        """
        Entrenar con partidos históricos - VERSION V4.1 con point-in-time features
        Corrige data leakage: calcula stats ANTES de cada partido
        
        Args:
            fixtures_historical: Lista de partidos ordenados por fecha
        """
        if not XGB_AVAILABLE:
            return False
        
        print(f"[XGB-V4.1] Entrenando match-level con {len(fixtures_historical)} partidos (point-in-time)...")
        
        # Guardar históricos para features en producción (V4.2)
        self.historical_fixtures = fixtures_historical
        
        # Ordenar por fecha para procesamiento temporal
        sorted_matches = sorted(fixtures_historical, key=lambda x: x['date'])
        
        # Timeline de stats acumuladas por equipo
        from collections import defaultdict
        team_stats_timeline = defaultdict(lambda: {
            'gf': 0,           # Goles a favor acumulados
            'ga': 0,           # Goles en contra acumulados
            'gf_home': 0,      # Goles a favor en casa
            'ga_home': 0,      # Goles en contra en casa
            'gf_away': 0,      # Goles a favor fuera
            'ga_away': 0,      # Goles en contra fuera
            'n_matches': 0,    # Partidos jugados
            'n_home': 0,       # Partidos en casa
            'n_away': 0,       # Partidos fuera
            'recent_results': [],  # Últimos 5 resultados [W,L,D,W,L]
            'recent_goals_for': [],  # Últimos 5 goles a favor
            'recent_goals_against': []  # Últimos 5 goles en contra
        })
        
        # H2H tracking
        h2h_history = defaultdict(list)  # {(team1, team2): [(gf1, ga1), ...]}
        
        X_over, y_over = [], []
        X_btts, y_btts = [], []
        
        for match in sorted_matches:
            home_id = match['home_team_id']
            away_id = match['away_team_id']
            home_goals = match['home_goals']
            away_goals = match['away_goals']
            total_goals = home_goals + away_goals
            
            # ════════════════════════════════════════════════════════════════
            # PASO 1: Extraer features ANTES del partido (sin leakage)
            # ════════════════════════════════════════════════════════════════
            
            home_stats = team_stats_timeline[home_id]
            away_stats = team_stats_timeline[away_id]
            
            # Skip si equipos no tienen suficientes partidos
            if home_stats['n_matches'] < 3 or away_stats['n_matches'] < 3:
                # Actualizar stats y continuar
                self._update_team_stats(team_stats_timeline, h2h_history, match)
                continue
            
            # Calcular features point-in-time
            features = []
            
            # 1. Stats básicas (promedios hasta este momento)
            features.append(home_stats['gf'] / max(home_stats['n_matches'], 1))  # home_gf_avg
            features.append(home_stats['ga'] / max(home_stats['n_matches'], 1))  # home_ga_avg
            features.append(away_stats['gf'] / max(away_stats['n_matches'], 1))  # away_gf_avg
            features.append(away_stats['ga'] / max(away_stats['n_matches'], 1))  # away_ga_avg
            
            # 2. Stats home/away específicas
            features.append(home_stats['gf_home'] / max(home_stats['n_home'], 1))  # home_gf_home_avg
            features.append(home_stats['ga_home'] / max(home_stats['n_home'], 1))  # home_ga_home_avg
            features.append(away_stats['gf_away'] / max(away_stats['n_away'], 1))  # away_gf_away_avg
            features.append(away_stats['ga_away'] / max(away_stats['n_away'], 1))  # away_ga_away_avg
            
            # 3. Forma reciente (últimos 5 partidos)
            home_form_score = self._calculate_form_score(home_stats['recent_results'])
            away_form_score = self._calculate_form_score(away_stats['recent_results'])
            features.append(home_form_score)
            features.append(away_form_score)
            
            # 4. Tendencia goles recientes (últimos 5)
            home_recent_gf = np.mean(home_stats['recent_goals_for'][-5:]) if home_stats['recent_goals_for'] else 0
            home_recent_ga = np.mean(home_stats['recent_goals_against'][-5:]) if home_stats['recent_goals_against'] else 0
            away_recent_gf = np.mean(away_stats['recent_goals_for'][-5:]) if away_stats['recent_goals_for'] else 0
            away_recent_ga = np.mean(away_stats['recent_goals_against'][-5:]) if away_stats['recent_goals_against'] else 0
            
            features.append(home_recent_gf)
            features.append(home_recent_ga)
            features.append(away_recent_gf)
            features.append(away_recent_ga)
            
            # 5. H2H histórico (últimos 3 enfrentamientos)
            h2h_key = tuple(sorted([home_id, away_id]))
            h2h_matches = h2h_history[h2h_key][-3:] if h2h_key in h2h_history else []
            
            if h2h_matches:
                h2h_total_goals_avg = np.mean([gf + ga for gf, ga in h2h_matches])
                h2h_btts_rate = sum([1 for gf, ga in h2h_matches if gf > 0 and ga > 0]) / len(h2h_matches)
            else:
                h2h_total_goals_avg = 2.5  # Default neutral
                h2h_btts_rate = 0.5
            
            features.append(h2h_total_goals_avg)
            features.append(h2h_btts_rate)
            
            # 6. Diferencias attack/defense
            attack_diff = (home_stats['gf'] / max(home_stats['n_matches'], 1)) - \
                         (away_stats['ga'] / max(away_stats['n_matches'], 1))
            defense_diff = (away_stats['gf'] / max(away_stats['n_matches'], 1)) - \
                          (home_stats['ga'] / max(home_stats['n_matches'], 1))
            features.append(attack_diff)
            features.append(defense_diff)
            
            # 7. Padding hasta 20 features (para consistencia con predict_probs)
            while len(features) < 20:
                features.append(0.0)
            
            # Total: 20 features (18 reales + 2 padding)
            
            # ════════════════════════════════════════════════════════════════
            # PASO 2: Añadir a dataset de entrenamiento
            # ════════════════════════════════════════════════════════════════
            
            X_over.append(features)
            y_over.append(1 if total_goals > 2.5 else 0)
            
            X_btts.append(features)
            y_btts.append(1 if (home_goals > 0 and away_goals > 0) else 0)
            
            # ════════════════════════════════════════════════════════════════
            # PASO 3: LUEGO actualizar stats con resultado (DESPUÉS de extraer features)
            # ════════════════════════════════════════════════════════════════
            
            self._update_team_stats(team_stats_timeline, h2h_history, match)
        
        # Validar datos suficientes
        if len(X_over) < 100:
            print(f"[XGB-V4.1] ⚠️ Muy pocos partidos válidos ({len(X_over)}), XGBoost desactivado")
            return False
        
        X_over = np.array(X_over)
        y_over = np.array(y_over)
        X_btts = np.array(X_btts)
        y_btts = np.array(y_btts)
        
        print(f"[XGB-V4.1] Entrenando con {len(X_over)} partidos (sin data leakage)...")
        print(f"[XGB-V4.1] Features: 20 (gf/ga, home/away, forma, tendencia, H2H, diffs)")
        
        # Entrenar modelos Over/Under
        self.model_over = xgb.XGBClassifier(
            max_depth=4,
            learning_rate=0.05,
            n_estimators=100,
            objective='binary:logistic',
            random_state=42,
            n_jobs=1
        )
        self.model_over.fit(X_over, y_over, verbose=False)
        
        self.model_under = xgb.XGBClassifier(
            max_depth=4,
            learning_rate=0.05,
            n_estimators=100,
            objective='binary:logistic',
            random_state=42,
            n_jobs=1
        )
        self.model_under.fit(X_over, 1 - y_over, verbose=False)
        
        # Entrenar modelos BTTS
        self.model_btts_yes = xgb.XGBClassifier(
            max_depth=4,
            learning_rate=0.05,
            n_estimators=100,
            objective='binary:logistic',
            random_state=42,
            n_jobs=1
        )
        self.model_btts_yes.fit(X_btts, y_btts, verbose=False)
        
        self.model_btts_no = xgb.XGBClassifier(
            max_depth=4,
            learning_rate=0.05,
            n_estimators=100,
            objective='binary:logistic',
            random_state=42,
            n_jobs=1
        )
        self.model_btts_no.fit(X_btts, 1 - y_btts, verbose=False)
        
        self.trained = True
        print(f"[XGB-V4.1] ✅ Match-level entrenado (Over/Under + BTTS, point-in-time)")
        return True
    
    def _calculate_form_score(self, recent_results):
        """Calcular score de forma reciente: W=3, D=1, L=0"""
        if not recent_results:
            return 1.5  # Neutral
        
        last_5 = recent_results[-5:]
        points = sum([3 if r == 'W' else (1 if r == 'D' else 0) for r in last_5])
        return points / (len(last_5) * 3)  # Normalizado 0-1
    
    def _update_team_stats(self, team_stats_timeline, h2h_history, match):
        """Actualizar stats de equipos DESPUÉS del partido"""
        home_id = match['home_team_id']
        away_id = match['away_team_id']
        home_goals = match['home_goals']
        away_goals = match['away_goals']
        
        # Actualizar home team
        team_stats_timeline[home_id]['gf'] += home_goals
        team_stats_timeline[home_id]['ga'] += away_goals
        team_stats_timeline[home_id]['gf_home'] += home_goals
        team_stats_timeline[home_id]['ga_home'] += away_goals
        team_stats_timeline[home_id]['n_matches'] += 1
        team_stats_timeline[home_id]['n_home'] += 1
        
        # Resultado home
        if home_goals > away_goals:
            result_home = 'W'
        elif home_goals < away_goals:
            result_home = 'L'
        else:
            result_home = 'D'
        
        team_stats_timeline[home_id]['recent_results'].append(result_home)
        team_stats_timeline[home_id]['recent_goals_for'].append(home_goals)
        team_stats_timeline[home_id]['recent_goals_against'].append(away_goals)
        
        # Actualizar away team
        team_stats_timeline[away_id]['gf'] += away_goals
        team_stats_timeline[away_id]['ga'] += home_goals
        team_stats_timeline[away_id]['gf_away'] += away_goals
        team_stats_timeline[away_id]['ga_away'] += home_goals
        team_stats_timeline[away_id]['n_matches'] += 1
        team_stats_timeline[away_id]['n_away'] += 1
        
        # Resultado away (inverso)
        result_away = 'L' if result_home == 'W' else ('W' if result_home == 'L' else 'D')
        
        team_stats_timeline[away_id]['recent_results'].append(result_away)
        team_stats_timeline[away_id]['recent_goals_for'].append(away_goals)
        team_stats_timeline[away_id]['recent_goals_against'].append(home_goals)
        
        # Actualizar H2H
        h2h_key = tuple(sorted([home_id, away_id]))
        h2h_history[h2h_key].append((home_goals, away_goals))
    
    
    def predict_probs(self, home_team_stats, away_team_stats):
        """
        Predecir probabilidades Over/Under/BTTS
        Usa las mismas 20 features que entrenamiento
        
        Returns:
            dict con 'over25', 'under25', 'btts_yes', 'btts_no'
        """
        if not self.trained:
            return None
        
        try:
            # Extraer las mismas 20 features que en entrenamiento
            home_n = max(home_team_stats.get('n_matches', 1), 1)
            away_n = max(away_team_stats.get('n_matches', 1), 1)
            home_n_home = max(home_team_stats.get('n_home', 1), 1)
            home_n_away = max(home_team_stats.get('n_away', 1), 1)
            away_n_home = max(away_team_stats.get('n_home', 1), 1)
            away_n_away = max(away_team_stats.get('n_away', 1), 1)
            
            features = []
            
            # 1-4. Stats básicas (igual que entrenamiento)
            features.append(home_team_stats.get('gf', 0) / home_n)
            features.append(home_team_stats.get('ga', 0) / home_n)
            features.append(away_team_stats.get('gf', 0) / away_n)
            features.append(away_team_stats.get('ga', 0) / away_n)
            
            # 5-8. Stats home/away específicas
            features.append(home_team_stats.get('gf_home', 0) / home_n_home)
            features.append(home_team_stats.get('ga_home', 0) / home_n_home)
            features.append(away_team_stats.get('gf_away', 0) / away_n_away)
            features.append(away_team_stats.get('ga_away', 0) / away_n_away)
            
            # 9-10. Forma reciente (V4.2: EMA real de últimos partidos)
            home_form_score = 0.5  # Default si no hay datos
            away_form_score = 0.5
            
            # Intentar calcular forma real si hay recent_results
            if home_team_stats.get('recent_results'):
                home_form_score = self._calculate_form_ema(
                    home_team_stats['recent_results'][-10:], 
                    alpha=0.3
                )
            
            if away_team_stats.get('recent_results'):
                away_form_score = self._calculate_form_ema(
                    away_team_stats['recent_results'][-10:],
                    alpha=0.3
                )
            
            features.append(home_form_score)
            features.append(away_form_score)
            
            # 11-14. Tendencia goles recientes (últimos partidos)
            # Aproximación: usar stats actuales como proxy
            home_recent_gf = home_team_stats.get('gf', 0) / home_n
            home_recent_ga = home_team_stats.get('ga', 0) / home_n
            away_recent_gf = away_team_stats.get('gf', 0) / away_n
            away_recent_ga = away_team_stats.get('ga', 0) / away_n
            features.append(home_recent_gf)
            features.append(home_recent_ga)
            features.append(away_recent_gf)
            features.append(away_recent_ga)
            
            # 15-16. H2H (V4.2: extraer de históricos reales)
            h2h_total_goals_avg = 2.5  # Default
            h2h_btts_rate = 0.5
            
            # Intentar extraer H2H real si tenemos IDs
            # Soporta tanto 'team_id' (nuevo) como ausencia (cache antiguo)
            home_id = home_team_stats.get('team_id')
            away_id = away_team_stats.get('team_id')
            
            if home_id and away_id and self.historical_fixtures:
                try:
                    h2h_total_goals_avg, h2h_btts_rate = self._extract_h2h_from_historicals(
                        home_id, away_id, max_matches=5
                    )
                except Exception as e:
                    # Si falla extracción H2H, usar defaults
                    pass
            
            features.append(h2h_total_goals_avg)
            features.append(h2h_btts_rate)
            
            # 17-18. Diferencias attack/defense
            attack_diff = (home_team_stats.get('gf', 0) / home_n) - \
                         (away_team_stats.get('ga', 0) / away_n)
            defense_diff = (away_team_stats.get('gf', 0) / away_n) - \
                          (home_team_stats.get('ga', 0) / home_n)
            features.append(attack_diff)
            features.append(defense_diff)
            
            # Padding hasta 20 features si faltan (no debería pasar)
            while len(features) < 20:
                features.append(0.0)
            
            X = np.array(features[:20]).reshape(1, -1)
            
            # Predecir Over/Under
            prob_over = float(self.model_over.predict_proba(X)[0][1])
            prob_under = float(self.model_under.predict_proba(X)[0][1])
            
            # Normalizar Over/Under
            total_ou = prob_over + prob_under
            if total_ou > 0:
                prob_over = prob_over / total_ou
                prob_under = prob_under / total_ou
            
            # Predecir BTTS
            prob_btts_yes = float(self.model_btts_yes.predict_proba(X)[0][1])
            prob_btts_no = float(self.model_btts_no.predict_proba(X)[0][1])
            
            # Normalizar BTTS
            total_btts = prob_btts_yes + prob_btts_no
            if total_btts > 0:
                prob_btts_yes = prob_btts_yes / total_btts
                prob_btts_no = prob_btts_no / total_btts
            
            # Validar probabilidades (V4.2.1: Fallback robusto)
            if (not (0 <= prob_over <= 1) or not (0 <= prob_under <= 1) or
                not (0 <= prob_btts_yes <= 1) or not (0 <= prob_btts_no <= 1)):
                self._log_fallback("Probabilidades inválidas (fuera de rango 0-1)")
                return None
            
            # Verificar NaN
            if (np.isnan(prob_over) or np.isnan(prob_under) or 
                np.isnan(prob_btts_yes) or np.isnan(prob_btts_no)):
                self._log_fallback("Probabilidades contienen NaN")
                return None
            
            return {
                'over25': prob_over * 100,
                'under25': prob_under * 100,
                'btts_yes': prob_btts_yes * 100,
                'btts_no': prob_btts_no * 100
            }
        
        except Exception as e:
            # V4.2.1: Logging detallado de errores
            self._log_fallback(f"Error prediciendo: {str(e)[:100]}")
            return None
    
    def get_current_weight(self):
        """Obtener peso adaptativo actual"""
        return self.adaptive_weight

# Instancia global (ahora usa AdvancedXGBPredictor V4)
xgb_predictor = AdvancedXGBPredictor() if (ENABLE_XGBOOST and XGB_AVAILABLE) else None

# =======================
# CONFIGURACIÓN OPTIMIZADA
# =======================
API_KEY_FOOTBALL = os.getenv("API_KEY_FOOTBALL")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_REPOSITORY = os.getenv("GITHUB_REPOSITORY")
HEADERS = {"x-rapidapi-key": API_KEY_FOOTBALL}

# =======================
# PATRONES REGEX PARA MATCHING DE ODDS
# MEJORA: Matching más robusto de nombres de mercados
# =======================
OVER_25_PATTERN = re.compile(r'\bover\s*\(?\s*2\.?5\s*\)?', re.IGNORECASE)
UNDER_25_PATTERN = re.compile(r'\bunder\s*\(?\s*2\.?5\s*\)?', re.IGNORECASE)
BTTS_YES_PATTERN = re.compile(r'\b(yes|si|sí|both.*score)\b', re.IGNORECASE)
BTTS_NO_PATTERN = re.compile(r'\b(no|neither.*score)\b', re.IGNORECASE)

LEAGUES_TO_SCAN = [
    39, 40, 140, 141, 135, 136, 78, 79, 61, 62, 88, 179, 94, 144, 207
]
SEASON = 2025
HISTORY_CSV = "over_under_value_bets.csv"
MAX_GOALS = 15
TOP_ALERTS = 30
# =======================
# PARÁMETROS SEPARADOS POR MERCADO (OVER vs UNDER)
# MEJORA: Modelos específicos optimizados para cada tipo de apuesta
# =======================

# PARÁMETROS PARA UNDER 2.5 (más conservador, rho más negativo)
# COHERENCIA: Solo varía rho_prior y xi_decay (parámetros más sensibles por mercado)
# FIJOS: home_adv y lambda_reg (mantienen coherencia física del modelo)
LEAGUE_PARAMS_UNDER = {
    39: {"xi_decay": 0.0028, "lambda_reg": 0.06, "home_adv": 0.28, "rho_prior": -0.14, "min_matches": 50},
    140: {"xi_decay": 0.0032, "lambda_reg": 0.07, "home_adv": 0.30, "rho_prior": -0.12, "min_matches": 50},
    135: {"xi_decay": 0.0034, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.11, "min_matches": 50},
    78: {"xi_decay": 0.0030, "lambda_reg": 0.065, "home_adv": 0.27, "rho_prior": -0.13, "min_matches": 50},
    61: {"xi_decay": 0.0033, "lambda_reg": 0.075, "home_adv": 0.25, "rho_prior": -0.10, "min_matches": 50},
    88: {"xi_decay": 0.0036, "lambda_reg": 0.09, "home_adv": 0.29, "rho_prior": -0.12, "min_matches": 45},
    40: {"xi_decay": 0.0039, "lambda_reg": 0.10, "home_adv": 0.24, "rho_prior": -0.09, "min_matches": 45},
    141: {"xi_decay": 0.0042, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.08, "min_matches": 45},
    136: {"xi_decay": 0.0040, "lambda_reg": 0.10, "home_adv": 0.22, "rho_prior": -0.09, "min_matches": 45},
    79: {"xi_decay": 0.0038, "lambda_reg": 0.09, "home_adv": 0.24, "rho_prior": -0.10, "min_matches": 45},
    62: {"xi_decay": 0.0041, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.08, "min_matches": 45},
    179: {"xi_decay": 0.0037, "lambda_reg": 0.095, "home_adv": 0.26, "rho_prior": -0.11, "min_matches": 40},
    94: {"xi_decay": 0.0035, "lambda_reg": 0.085, "home_adv": 0.27, "rho_prior": -0.12, "min_matches": 45},
    144: {"xi_decay": 0.0034, "lambda_reg": 0.08, "home_adv": 0.28, "rho_prior": -0.11, "min_matches": 45},
    207: {"xi_decay": 0.0036, "lambda_reg": 0.09, "home_adv": 0.26, "rho_prior": -0.10, "min_matches": 45},
}

# PARÁMETROS PARA OVER 2.5 (más agresivo, rho menos negativo)
# COHERENCIA: Solo varía rho_prior y xi_decay
# FIJOS: home_adv y lambda_reg (iguales a params generales)
LEAGUE_PARAMS_OVER = {
    39: {"xi_decay": 0.0022, "lambda_reg": 0.06, "home_adv": 0.28, "rho_prior": -0.09, "min_matches": 50},
    140: {"xi_decay": 0.0024, "lambda_reg": 0.07, "home_adv": 0.30, "rho_prior": -0.08, "min_matches": 50},
    135: {"xi_decay": 0.0026, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.07, "min_matches": 50},
    78: {"xi_decay": 0.0024, "lambda_reg": 0.065, "home_adv": 0.27, "rho_prior": -0.09, "min_matches": 50},
    61: {"xi_decay": 0.0025, "lambda_reg": 0.075, "home_adv": 0.25, "rho_prior": -0.06, "min_matches": 50},
    88: {"xi_decay": 0.0028, "lambda_reg": 0.09, "home_adv": 0.29, "rho_prior": -0.08, "min_matches": 45},
    40: {"xi_decay": 0.0031, "lambda_reg": 0.10, "home_adv": 0.24, "rho_prior": -0.05, "min_matches": 45},
    141: {"xi_decay": 0.0034, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.04, "min_matches": 45},
    136: {"xi_decay": 0.0032, "lambda_reg": 0.10, "home_adv": 0.22, "rho_prior": -0.05, "min_matches": 45},
    79: {"xi_decay": 0.0030, "lambda_reg": 0.09, "home_adv": 0.24, "rho_prior": -0.06, "min_matches": 45},
    62: {"xi_decay": 0.0033, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.04, "min_matches": 45},
    179: {"xi_decay": 0.0029, "lambda_reg": 0.095, "home_adv": 0.26, "rho_prior": -0.07, "min_matches": 40},
    94: {"xi_decay": 0.0027, "lambda_reg": 0.085, "home_adv": 0.27, "rho_prior": -0.08, "min_matches": 45},
    144: {"xi_decay": 0.0026, "lambda_reg": 0.08, "home_adv": 0.28, "rho_prior": -0.07, "min_matches": 45},
    207: {"xi_decay": 0.0028, "lambda_reg": 0.09, "home_adv": 0.26, "rho_prior": -0.06, "min_matches": 45},
}

# PARÁMETROS PARA BTTS (valores intermedios)
# COHERENCIA: Solo varía rho_prior y xi_decay
# FIJOS: home_adv y lambda_reg (iguales a params generales)
LEAGUE_PARAMS_BTTS = {
    39: {"xi_decay": 0.0025, "lambda_reg": 0.06, "home_adv": 0.28, "rho_prior": -0.11, "min_matches": 50},
    140: {"xi_decay": 0.0028, "lambda_reg": 0.07, "home_adv": 0.30, "rho_prior": -0.09, "min_matches": 50},
    135: {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.08, "min_matches": 50},
    78: {"xi_decay": 0.0027, "lambda_reg": 0.065, "home_adv": 0.27, "rho_prior": -0.10, "min_matches": 50},
    61: {"xi_decay": 0.0029, "lambda_reg": 0.075, "home_adv": 0.25, "rho_prior": -0.07, "min_matches": 50},
    88: {"xi_decay": 0.0032, "lambda_reg": 0.09, "home_adv": 0.29, "rho_prior": -0.09, "min_matches": 45},
    40: {"xi_decay": 0.0035, "lambda_reg": 0.10, "home_adv": 0.24, "rho_prior": -0.06, "min_matches": 45},
    141: {"xi_decay": 0.0038, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.05, "min_matches": 45},
    136: {"xi_decay": 0.0036, "lambda_reg": 0.10, "home_adv": 0.22, "rho_prior": -0.06, "min_matches": 45},
    79: {"xi_decay": 0.0034, "lambda_reg": 0.09, "home_adv": 0.24, "rho_prior": -0.07, "min_matches": 45},
    62: {"xi_decay": 0.0037, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.05, "min_matches": 45},
    179: {"xi_decay": 0.0033, "lambda_reg": 0.095, "home_adv": 0.26, "rho_prior": -0.08, "min_matches": 40},
    94: {"xi_decay": 0.0031, "lambda_reg": 0.085, "home_adv": 0.27, "rho_prior": -0.09, "min_matches": 45},
    144: {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.28, "rho_prior": -0.08, "min_matches": 45},
    207: {"xi_decay": 0.0032, "lambda_reg": 0.09, "home_adv": 0.26, "rho_prior": -0.07, "min_matches": 45},
}

# PARÁMETROS GENERALES (backward compatibility para código que no especifica mercado)
LEAGUE_PARAMS = {
    39: {"xi_decay": 0.0025, "lambda_reg": 0.06, "home_adv": 0.28, "rho_prior": -0.12, "min_matches": 50},
    140: {"xi_decay": 0.0028, "lambda_reg": 0.07, "home_adv": 0.30, "rho_prior": -0.10, "min_matches": 50},
    135: {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.09, "min_matches": 50},
    78: {"xi_decay": 0.0027, "lambda_reg": 0.065, "home_adv": 0.27, "rho_prior": -0.11, "min_matches": 50},
    61: {"xi_decay": 0.0029, "lambda_reg": 0.075, "home_adv": 0.25, "rho_prior": -0.08, "min_matches": 50},
    88: {"xi_decay": 0.0032, "lambda_reg": 0.09, "home_adv": 0.29, "rho_prior": -0.10, "min_matches": 45},
    40: {"xi_decay": 0.0035, "lambda_reg": 0.10, "home_adv": 0.24, "rho_prior": -0.07, "min_matches": 45},
    141: {"xi_decay": 0.0038, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.06, "min_matches": 45},
    136: {"xi_decay": 0.0036, "lambda_reg": 0.10, "home_adv": 0.22, "rho_prior": -0.07, "min_matches": 45},
    79: {"xi_decay": 0.0034, "lambda_reg": 0.09, "home_adv": 0.24, "rho_prior": -0.08, "min_matches": 45},
    62: {"xi_decay": 0.0037, "lambda_reg": 0.11, "home_adv": 0.23, "rho_prior": -0.06, "min_matches": 45},
    179: {"xi_decay": 0.0033, "lambda_reg": 0.095, "home_adv": 0.26, "rho_prior": -0.09, "min_matches": 40},
    94: {"xi_decay": 0.0031, "lambda_reg": 0.085, "home_adv": 0.27, "rho_prior": -0.10, "min_matches": 45},
    144: {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.28, "rho_prior": -0.09, "min_matches": 45},  # Bélgica
    207: {"xi_decay": 0.0032, "lambda_reg": 0.09, "home_adv": 0.26, "rho_prior": -0.08, "min_matches": 45},  # Suiza
}

DEFAULT_PARAMS_UNDER = {"xi_decay": 0.0030, "lambda_reg": 0.09, "home_adv": 0.28, "rho_prior": -0.11, "min_matches": 45}
DEFAULT_PARAMS_OVER = {"xi_decay": 0.0030, "lambda_reg": 0.06, "home_adv": 0.24, "rho_prior": -0.07, "min_matches": 45}
DEFAULT_PARAMS_BTTS = {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.08, "min_matches": 45}
DEFAULT_PARAMS = {"xi_decay": 0.0030, "lambda_reg": 0.08, "home_adv": 0.26, "rho_prior": -0.08, "min_matches": 45}
MIN_ODD = 1.80
MAX_ODD = 2.10
FRACTIONAL_KELLY = 0.25
CALIBRATION_ALPHA = 0.92
CALIBRATION_BETA = 0.08
BANKROLL_INICIAL = 200.0
FALLBACK_STAKE_FLAT = 100.0
cache = {
    "teams": {}, 
    "leagues": {}, 
    "dc_params": {},           # General (backward compatibility)
    "dc_params_over": {},      # NUEVO: Parámetros optimizados para Over 2.5
    "dc_params_under": {},     # NUEVO: Parámetros optimizados para Under 2.5
    "dc_params_btts": {},      # NUEVO: Parámetros optimizados para BTTS
    "h2h": {}, 
    "form": {}
}

def calculate_dynamic_calibration(csv_file):
    """
    MEJORA #3 V2: Calibración dinámica MEJORADA POR MERCADO
    
    NUEVAS CARACTERÍSTICAS:
    ✅ Detección de underconfidence (modelo conservador ganando mucho)
    ✅ Suavizado bayesiano (previene overfitting con pocas muestras)
    ✅ Análisis más granular de win rate y probabilidades promedio
    ✅ Mantiene compatibilidad total con código existente
    
    Analiza apuestas pasadas SEPARADAS POR MERCADO para determinar si el modelo está:
    - Overconfident (predice alto pero pierde) → confiar más en mercado
    - Underconfident (predice bajo pero gana) → confiar más en modelo
    - Bien calibrado → mantener balance
    
    Returns: dict con (alpha, beta) por cada mercado
    {
        "over25": (0.85, 0.15),
        "under25": (0.92, 0.08),
        "btts_yes": (0.90, 0.10),
        "btts_no": (0.92, 0.08)
    }
    """
    # Defaults conservadores por mercado (priors bayesianos)
    default_calibrations = {
        "over25": (0.88, 0.12),    # Over más suave
        "under25": (0.92, 0.08),   # Under estándar (funciona bien)
        "btts_yes": (0.90, 0.10),  # BTTS moderado
        "btts_no": (0.92, 0.08)    # BTTS No estándar
    }
    
    if not os.path.exists(csv_file):
        print("[CALIBRATION V2] CSV no existe, usando valores por defecto por mercado")
        return default_calibrations
    
    try:
        with open(csv_file, 'r', encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            rows = [r for r in reader if r.get('bet_result') in ['Ganada', 'Perdida']]
        
        if len(rows) < 30:
            print(f"[CALIBRATION V2] Solo {len(rows)} apuestas resueltas, usando valores por defecto (mínimo 30)")
            return default_calibrations
        
        # Mapeo de selecciones a keys de mercado
        selection_to_key = {
            "Over 2.5": "over25",
            "Under 2.5": "under25",
            "BTTS Yes": "btts_yes",
            "BTTS No": "btts_no"
        }
        
        # NUEVO: Estadísticas más detalladas por mercado
        market_stats = {
            "over25": {"wins": 0, "losses": 0, "total": 0, "model_probs": [], "high_conf_losses": 0, "high_conf_total": 0},
            "under25": {"wins": 0, "losses": 0, "total": 0, "model_probs": [], "high_conf_losses": 0, "high_conf_total": 0},
            "btts_yes": {"wins": 0, "losses": 0, "total": 0, "model_probs": [], "high_conf_losses": 0, "high_conf_total": 0},
            "btts_no": {"wins": 0, "losses": 0, "total": 0, "model_probs": [], "high_conf_losses": 0, "high_conf_total": 0}
        }
        
        # Recopilar estadísticas
        for row in rows:
            try:
                selection = row.get("selection", "")
                market_key = selection_to_key.get(selection)
                
                if not market_key:
                    continue
                
                model_prob = float(row.get('model_prob_calibrated', 0))
                won = (row['bet_result'] == 'Ganada')
                
                # Estadísticas generales
                market_stats[market_key]["total"] += 1
                market_stats[market_key]["model_probs"].append(model_prob)
                
                if won:
                    market_stats[market_key]["wins"] += 1
                else:
                    market_stats[market_key]["losses"] += 1
                
                # Estadísticas de alta confianza (>60%)
                if model_prob >= 60:
                    market_stats[market_key]["high_conf_total"] += 1
                    if not won:
                        market_stats[market_key]["high_conf_losses"] += 1
                        
            except (ValueError, KeyError):
                continue
        
        # Calcular alpha/beta POR MERCADO con lógica mejorada
        calibrations = {}
        
        for market, stats in market_stats.items():
            default_alpha, default_beta = default_calibrations[market]
            
            # Si muy pocas muestras totales, usar default puro
            if stats["total"] < 10:
                calibrations[market] = default_calibrations[market]
                print(f"[CALIBRATION V2] {market}: Pocas muestras totales ({stats['total']}), usando default {default_calibrations[market]}")
                continue
            
            # Calcular métricas
            win_rate = stats["wins"] / stats["total"] if stats["total"] > 0 else 0
            avg_model_prob = sum(stats["model_probs"]) / len(stats["model_probs"]) if stats["model_probs"] else 0
            
            # Calcular loss rate en alta confianza
            if stats["high_conf_total"] >= 5:  # Mínimo 5 apuestas de alta confianza
                high_conf_loss_rate = stats["high_conf_losses"] / stats["high_conf_total"]
            else:
                # Si pocas muestras de alta confianza, usar win rate general como proxy
                high_conf_loss_rate = 1 - win_rate
            
            # NUEVA LÓGICA: Detectar overconfidence Y underconfidence
            
            # 1. OVERCONFIDENCE: Modelo predice alto pero pierde mucho
            if high_conf_loss_rate > 0.45:  # >45% pérdidas en alta confianza
                # Muy overconfident → confiar MÁS en mercado
                estimated_alpha, estimated_beta = 0.82, 0.18
                confidence_label = "MUY overconfident"
                
            elif high_conf_loss_rate > 0.40:  # 40-45% pérdidas
                # Ligeramente overconfident
                estimated_alpha, estimated_beta = 0.87, 0.13
                confidence_label = "Overconfident"
                
            # 2. UNDERCONFIDENCE: Modelo gana mucho con probabilidades altas
            elif win_rate > 0.65 and avg_model_prob > 65:
                # Underconfident → confiar MÁS en modelo
                estimated_alpha, estimated_beta = 0.95, 0.05
                confidence_label = "Underconfident (ganando mucho)"
                
            elif win_rate > 0.60 and avg_model_prob > 60:
                # Ligeramente underconfident
                estimated_alpha, estimated_beta = 0.93, 0.07
                confidence_label = "Ligeramente underconfident"
                
            # 3. BIEN CALIBRADO
            else:
                estimated_alpha, estimated_beta = 0.92, 0.08
                confidence_label = "Bien calibrado"
            
            # SUAVIZADO BAYESIANO: Mezclar estimate con prior según cantidad de datos
            # Con pocas muestras, confiar más en default (prior)
            # Con muchas muestras, confiar más en estimate (likelihood)
            
            # Weight decae exponencialmente con más datos
            # 10 samples → weight=0.67, 20→0.50, 30→0.37, 50→0.22, 100→0.05
            prior_weight = max(0, min(1, math.exp(-stats["total"] / 30)))
            
            # Weighted average
            final_alpha = prior_weight * default_alpha + (1 - prior_weight) * estimated_alpha
            final_beta = prior_weight * default_beta + (1 - prior_weight) * estimated_beta
            
            # Normalizar (alpha + beta debe sumar 1.0)
            total = final_alpha + final_beta
            final_alpha = final_alpha / total
            final_beta = final_beta / total
            
            calibrations[market] = (final_alpha, final_beta)
            
            # Log detallado
            print(f"[CALIBRATION V2] {market}: {confidence_label}")
            print(f"  └─ Stats: {stats['total']} picks, WR={win_rate:.1%}, Avg model prob={avg_model_prob:.1f}%")
            print(f"  └─ High conf: {stats['high_conf_total']} picks, loss rate={high_conf_loss_rate:.1%}")
            print(f"  └─ Estimated: α={estimated_alpha:.2f}, β={estimated_beta:.2f}")
            print(f"  └─ Bayesian smoothing: prior_weight={prior_weight:.2f}")
            print(f"  └─ FINAL: α={final_alpha:.3f}, β={final_beta:.3f}")
        
        return calibrations
    
    except Exception as e:
        print(f"[CALIBRATION V2] Error calculando calibración dinámica: {e}")
        return default_calibrations

def calculate_market_weight(key, dc_quality, total_lambda):
    """
    MEJORA #4: Pesos de ensemble dinámicos según características del partido
    
    Ajusta el peso entre Dixon-Coles y modelo simple basándose en:
    - Total lambda (scoring esperado del partido)
    - Mercado específico (Over/Under/BTTS)
    - Calidad de DC
    
    Rationale:
    - En partidos de bajo scoring, el modelo simple es más confiable para Over
    - En partidos de alto scoring, DC es mejor para Under
    - BTTS es más estable, usar peso estándar
    """
    base_weight = min(0.80, 0.70 + 0.25 * dc_quality)
    
    if key == "over25":
        # En partidos de bajo scoring (<2.2 goles esperados), confiar menos en DC
        # DC tiende a ser overconfident en overs de partidos cerrados
        if total_lambda < 2.2:
            return max(0.40, base_weight - 0.15)
        else:
            return max(0.30, base_weight - 0.10)  # Valor original
    
    elif key == "under25":
        # En partidos de alto scoring (>3.2 goles), confiar más en DC
        # DC captura mejor la dinámica de partidos abiertos
        if total_lambda > 3.2:
            return min(0.90, base_weight + 0.10)
        else:
            return min(0.95, base_weight + 0.10)  # Valor original
    
    else:  # BTTS (btts_yes, btts_no)
        # MEJORA: BTTS tiende a estar sobrevalorado por modelos Poisson/DC en partidos defensivos
        # En partidos de bajo scoring, BTTS es mucho más difícil de acertar
        if total_lambda < 2.2:  # Partido muy defensivo
            # Reducir peso de DC significativamente (confiar menos en el modelo)
            return max(0.55, base_weight - 0.12)
        elif total_lambda < 2.5:  # Partido defensivo moderado
            # Reducir peso de DC moderadamente
            return max(0.65, base_weight - 0.06)
        else:
            # Partidos normales/ofensivos: peso estándar
            return base_weight

def min_edge_required(odd, market_key=None):
    """
    Edge mínimo optimizado: DIFERENCIADO POR MERCADO
    
    Cambio realizado: 23 Enero 2026
    Versión anterior: 8.0% fijo para todos
    Nueva versión: Diferenciado por mercado
    
    Razón del cambio:
    - Over 2.5: Edge 8% → WR 44% (malo) | Edge 10.5% → WR ~55% (mejor)
    - Under 2.5: Edge 8% → WR 72% (excelente) | Puede ser más permisivo
    - BTTS: Edge 8% → WR variable | Mantener estándar
    
    Mercados:
    - over25: 10.5% (más estricto - compensar descalibración)
    - under25: 7.5% (más permisivo - ya funciona bien)
    - btts: 8.5% (moderado)
    - default: 8.0%
    
    Resultado esperado: 
    - Over: Filtra ~60% de apuestas malas
    - Under: ~20% más apuestas (buenas)
    - ROI esperado: +10-12% vs actual -24.89%
    """
    base = 8.0
    
    if market_key == "over25":
        return base + 2.0  # 10.0% para Over 2.5 (ajustado de 10.5%)
    elif market_key == "under25":
        return base - 0.5  # 7.5% para Under 2.5
    elif market_key in ["btts_yes", "btts_no"]:
        return base + 0.5  # 8.5% para BTTS
    
    return base  # 8.0% default
def git_setup():
    subprocess.run(["git", "config", "--global", "user.name", "github-actions[bot]"], check=True)
    subprocess.run(["git", "config", "--global", "user.email", "github-actions[bot]@users.noreply.github.com"], check=True)
def git_pull():
    print("[GIT] Sincronizando con el repositorio (pull)...")
    result = subprocess.run(["git", "pull", "origin", "main", "--rebase"], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[GIT] Pull falló: {result.stderr}")
        subprocess.run(["git", "fetch", "origin", "main"], check=False)
        subprocess.run(["git", "reset", "--hard", "origin/main"], check=False)
        print("[GIT] Reset forzado a origin/main.")
    else:
        print("[GIT] Pull exitoso.")
def git_commit_and_push():
    print("[GIT] Verificando cambios para commit...")
    if not os.path.exists(HISTORY_CSV):
        print("[GIT] El CSV no existe localmente.")
        return
    subprocess.run(["git", "add", HISTORY_CSV], check=True)
    status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True).stdout
    if not status.strip():
        print("[GIT] No hay cambios.")
        return
    print("[GIT] Haciendo commit y push.")
    commit_msg = f"Update value bets - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    subprocess.run(["git", "commit", "-m", commit_msg], capture_output=True, text=True)
    push_url = f"https://{GITHUB_TOKEN}@github.com/{GITHUB_REPOSITORY}.git"
    subprocess.run(["git", "push", push_url, "HEAD:main"], capture_output=True, text=True)
    print("[GIT] PUSH EXITOSO.")
def send_telegram(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    try:
        r = requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "Markdown", "disable_web_page_preview": True})
        return r.status_code == 200
    except Exception as e:
        print(f"Error Telegram: {e}")
        return False
def send_todays_open_bets(existing_rows, execution_date):
    """
    Envía resumen de apuestas abiertas SOLO para el día actual por Telegram.
    
    Args:
        existing_rows: Lista de filas del CSV
        execution_date: Fecha de ejecución (formato: "YYYY-MM-DD HH:MM")
    """
    from datetime import datetime, timezone
    
    try:
        # Obtener fecha actual (solo día, sin hora)
        now = datetime.now(timezone.utc)
        today_date = now.date()  # Solo YYYY-MM-DD
        
        # Filtrar apuestas abiertas para HOY
        todays_bets = []
        for row in existing_rows:
            # Saltar si ya tiene resultado
            if row.get("bet_result", "").strip():
                continue
            
            # Parsear fecha del partido
            match_date_str = row.get("match_date", "")
            match_dt = parse_date_flexible(match_date_str)
            
            if not match_dt:
                continue
            
            # Comparar SOLO la fecha (ignorar hora)
            match_date = match_dt.date()
            
            # Solo apuestas para HOY
            if match_date != today_date:
                continue
            
            # Solo apuestas con confidence >= 60% (las válidas)
            try:
                conf = float(row.get("confidence_score", 0) or 0)
            except:
                conf = 0
            
            if conf < 60:
                continue
            
            # Obtener valores básicos
            try:
                # Priorizar edge_actual (nuevo formato), fallback a edge (antiguo formato)
                edge = float(row.get("edge_actual") or row.get("edge", 0) or 0)
                kelly = float(row.get("kelly", 0) or 0)
            except:
                edge = 0
                kelly = 0
            
            # Obtener odds (primera, actual, modelo)
            try:
                primera_cuota = float(row.get("primera_cuota", 0) or 0)
            except:
                primera_cuota = 0
            
            try:
                ultima_cuota = float(row.get("ultima_cuota", 0) or 0)
            except:
                ultima_cuota = 0
            
            try:
                fair_odd = float(row.get("fair_odd", 0) or 0)
            except:
                fair_odd = 0
            
            # Calcular probabilidades implícitas
            primera_prob = (100 / primera_cuota) if primera_cuota > 0 else 0
            ultima_prob = (100 / ultima_cuota) if ultima_cuota > 0 else 0
            fair_prob = (100 / fair_odd) if fair_odd > 0 else 0
            
            todays_bets.append({
                'home': row.get('home_team', ''),
                'away': row.get('away_team', ''),
                'selection': row.get('selection', ''),
                'confidence': conf,
                'edge': edge,
                'kelly': kelly,
                'match_dt': match_dt,
                'league': row.get('league', ''),
                # Odds
                'primera_cuota': primera_cuota,
                'ultima_cuota': ultima_cuota,
                'fair_odd': fair_odd,
                # Probabilidades
                'primera_prob': primera_prob,
                'ultima_prob': ultima_prob,
                'fair_prob': fair_prob
            })
        
        # Si no hay apuestas para hoy
        if not todays_bets:
            send_telegram(f"ℹ️ No hay apuestas abiertas para hoy {today_date.strftime('%d/%m/%Y')}")
            print("[TELEGRAM] No hay apuestas para hoy.")
            return
        
        # Ordenar por hora del partido (más cercano primero)
        todays_bets.sort(key=lambda x: x['match_dt'])
        
        # Calcular totales
        total_kelly = sum(b['kelly'] for b in todays_bets)
        first_match = todays_bets[0]['match_dt'].strftime('%H:%M')
        
        # Construir mensaje
        msg = f"📅 APUESTAS ABIERTAS HOY - {today_date.strftime('%d/%m/%Y')}\n\n"
        msg += f"🔴 PENDIENTES ({len(todays_bets)}):\n\n"
        
        # Mostrar hasta 10 apuestas (para no saturar)
        for i, bet in enumerate(todays_bets[:10], 1):
            match_time = bet['match_dt'].strftime('%H:%M')
            msg += f"{i}️⃣ {bet['home']} vs {bet['away']} - {match_time}\n"
            msg += f"   🎯 {bet['selection']}\n"
            msg += f"   📊 Conf: {bet['confidence']:.0f}% | Edge: +{bet['edge']:.1f}%\n"
            msg += f"   🏦 Kelly: {bet['kelly']:.1f}%\n"
            
            # Añadir información de odds y probabilidades
            msg += f"\n"
            msg += f"   📥 Primera: {bet['primera_cuota']:.2f} ({bet['primera_prob']:.1f}%)\n"
            msg += f"   📊 Actual:  {bet['ultima_cuota']:.2f} ({bet['ultima_prob']:.1f}%)\n"
            msg += f"   🎲 Modelo:  {bet['fair_odd']:.2f} ({bet['fair_prob']:.1f}%)\n"
            msg += f"\n"
        
        if len(todays_bets) > 10:
            msg += f"... y {len(todays_bets) - 10} más\n\n"
        
        msg += f"💰 Kelly total sugerido: {total_kelly:.1f}%\n"
        msg += f"⏰ Próximo partido: {first_match}"
        
        # Enviar mensaje
        send_telegram(msg)
        print(f"[TELEGRAM] Resumen de {len(todays_bets)} apuestas para hoy enviado.")
        
    except Exception as e:
        print(f"[TELEGRAM] Error enviando resumen de apuestas: {e}")

def send_yesterday_results(existing_rows):
    """
    Envía resumen de resultados del DÍA ANTERIOR por Telegram.
    
    Args:
        existing_rows: Lista de filas del CSV
    """
    from datetime import datetime, timezone, timedelta
    
    try:
        # Obtener fecha de ayer
        now = datetime.now(timezone.utc)
        yesterday_date = (now - timedelta(days=1)).date()
        
        # Filtrar apuestas resueltas de AYER
        yesterday_bets = []
        for row in existing_rows:
            # Solo apuestas con resultado
            bet_result = row.get("bet_result", "").strip()
            if bet_result not in ["Ganada", "Perdida"]:
                continue
            
            # Parsear fecha del partido
            match_date_str = row.get("match_date", "")
            match_dt = parse_date_flexible(match_date_str)
            
            if not match_dt:
                continue
            
            match_date = match_dt.date()
            
            # Solo partidos de AYER
            if match_date != yesterday_date:
                continue
            
            yesterday_bets.append(row)
        
        # Si no hay apuestas de ayer, no enviar nada
        if not yesterday_bets:
            print(f"[TELEGRAM] No hay resultados de ayer para enviar.")
            return
        
        # Calcular estadísticas
        total_bets = len(yesterday_bets)
        won_bets = sum(1 for b in yesterday_bets if b.get("bet_result") == "Ganada")
        lost_bets = total_bets - won_bets
        win_rate = (won_bets / total_bets * 100) if total_bets > 0 else 0
        
        # Calcular unidades
        total_staked = 0
        total_return = 0
        
        for bet in yesterday_bets:
            try:
                kelly = float(bet.get("kelly", 0) or 0)
                odd = float(bet.get("betfair_odd", 0) or 0)
                result = bet.get("bet_result", "")
                
                stake = kelly  # Kelly ya es el porcentaje de bankroll
                total_staked += stake
                
                if result == "Ganada":
                    total_return += stake * odd
                # Si perdida, return = 0
                
            except:
                continue
        
        profit = total_return - total_staked
        roi = (profit / total_staked * 100) if total_staked > 0 else 0
        
        # Estadísticas por mercado
        market_stats = {}
        for bet in yesterday_bets:
            market = bet.get("selection", "Unknown")
            
            if market not in market_stats:
                market_stats[market] = {"won": 0, "total": 0, "profit": 0}
            
            market_stats[market]["total"] += 1
            
            try:
                kelly = float(bet.get("kelly", 0) or 0)
                odd = float(bet.get("betfair_odd", 0) or 0)
                result = bet.get("bet_result", "")
                
                stake = kelly
                
                if result == "Ganada":
                    market_stats[market]["won"] += 1
                    market_stats[market]["profit"] += stake * odd - stake
                else:
                    market_stats[market]["profit"] -= stake
                    
            except:
                continue
        
        # Construir mensaje
        fecha_str = yesterday_date.strftime("%d/%m/%Y")
        
        msg = f"📊 *Resultados de ayer ({fecha_str}):*\n\n"
        msg += f"Apuestas resueltas: *{total_bets}*\n"
        msg += f"✅ Ganadas: *{won_bets}* ({win_rate:.1f}%)\n"
        msg += f"❌ Perdidas: *{lost_bets}* ({100-win_rate:.1f}%)\n\n"
        
        msg += f"💰 *Balance:*\n"
        msg += f"Apostado: {total_staked:.1f} unidades\n"
        msg += f"Ganado: {total_return:.1f} unidades\n"
        
        profit_symbol = "+" if profit >= 0 else ""
        msg += f"Profit: *{profit_symbol}{profit:.1f} unidades*\n"
        msg += f"ROI: *{profit_symbol}{roi:.1f}%*\n"
        
        # Por mercado (solo si hay más de 1 mercado)
        if len(market_stats) > 1:
            msg += f"\n🏆 *Por mercado:*\n"
            for market, stats in sorted(market_stats.items(), key=lambda x: x[1]["profit"], reverse=True):
                win_pct = (stats["won"] / stats["total"] * 100) if stats["total"] > 0 else 0
                profit_sym = "+" if stats["profit"] >= 0 else ""
                msg += f"• {market}: {stats['won']}/{stats['total']} ({win_pct:.0f}%) | {profit_sym}{stats['profit']:.1f}u\n"
        
        # Enviar mensaje
        send_telegram(msg)
        print(f"[TELEGRAM] Resumen de {total_bets} resultados de ayer enviado.")
        
    except Exception as e:
        print(f"[TELEGRAM] Error enviando resultados de ayer: {e}")

def api_get(url):
    backoff_times = [5, 10, 20, 40, 80, 160]
    for attempt, sleep_time in enumerate(backoff_times):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 429:
                print(f"[API] Rate limit (429), esperando {sleep_time}s antes de reintento {attempt + 1}...")
                time.sleep(sleep_time)
            else:
                print(f"[API] Error {r.status_code}, esperando {sleep_time}s antes de reintento...")
                time.sleep(sleep_time)
        except Exception as e:
            print(f"[API] Excepción: {e}, esperando {sleep_time}s antes de reintento {attempt + 1}...")
            time.sleep(sleep_time)
    print("[API] Fallo definitivo tras todos los reintentos.")
    return {"response": []}
def save_cache():
    try:
        with open("stats_cache.json", "w") as f:
            json.dump(cache, f)
    except:
        pass
def normalize_team_name(name):
    if not name:
        return ""
    original_lower = name.lower()
    name_clean = original_lower
    name_clean = name_clean.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u").replace("ñ", "n")
    name_clean = name_clean.replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")
    suffixes = [" fc", " cf", " ac", " as", " sd", " ud", " cd", " rc", " sc", " afc", " united", " city", " athletic", " deportivo", " real", " racing", " sporting", " calcio", " club", " athletic club"]
    normalized = name_clean
    for s in suffixes:
        normalized = normalized.replace(s, "")
    replacements = {
        "manchester utd": "manchester united",
        "man utd": "manchester united",
        "atletico madrid": "atl madrid",
        "atlético madrid": "atl madrid",
        "bayern munich": "bayern munchen",
        "fc bayern munchen": "bayern munchen",
        "psg": "paris saint germain",
        "paris sg": "paris saint germain",
        "juventus": "juve",
        "inter milan": "inter",
        "ac milan": "milan",
        "as roma": "roma",
        "ssc napoli": "napoli",
        "borussia dortmund": "dortmund",
        "borussia mgladbach": "monchengladbach",
        "sporting cp": "sporting lisbon",
        "fc porto": "porto",
        "sl benfica": "benfica",
        "torino fc": "torino",
        "udinese calcio": "udinese"
    }
    for old, new in replacements.items():
        normalized = normalized.replace(old, new)
    normalized = normalized.strip()
    if len(normalized.split()) <= 1 or normalized == "":
        return name_clean.strip()
    return normalized
def parse_date_flexible(date_str):
    """ Parsea fechas de forma robusta, priorizando formatos ISO y europeos. Evita ambigüedades en formatos como mm/dd/yy. """
    if not date_str:
        return None
    date_str = date_str.strip()
    # Formatos priorizados (de más específico a menos)
    formats = [
        '%Y-%m-%dT%H:%M:%S%z', # ISO con timezone
        '%Y-%m-%dT%H:%M:%SZ', # ISO UTC
        '%Y-%m-%d %H:%M:%S', # ISO sin timezone
        '%Y-%m-%d %H:%M', # ISO corto
        '%Y-%m-%d', # Solo fecha ISO
        '%d/%m/%Y %H:%M', # Europeo con hora (DÍA primero)
        '%d/%m/%y %H:%M', # Europeo corto
        '%d/%m/%Y', # Solo fecha europea
        '%d/%m/%y',
        '%m/%d/%Y %H:%M', # US con hora (al final por ambigüedad)
        '%m/%d/%y %H:%M',
        '%m/%d/%Y',
        '%m/%d/%y',
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            # Si no tiene hora, establecer a medianoche
            if '%H' not in fmt:
                dt = dt.replace(hour=0, minute=0, second=0)
            # Asegurar timezone UTC
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            # Validación de fecha razonable (entre 2020 y 2030)
            if not (2020 <= dt.year <= 2030):
                continue
            return dt
        except ValueError:
            continue
    # Si ningún formato funciona, intentar con dateutil como fallback
    try:
        from dateutil import parser
        dt = parser.parse(date_str, dayfirst=True) # Priorizar día primero
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except:
        pass
    print(f"[WARNING] No se pudo parsear fecha: '{date_str}'")
    return None
def save_or_update_history_csv(rows_to_process, existing_rows, current_time):
    fieldnames = [
        "execution_date", "match_date", "league", "home_team", "away_team",
        "market", "selection", "betfair_odd", "model_prob_raw", "model_prob_calibrated",
        "fair_odd", "edge_inicial", "edge_actual", "kelly", "model_used", "confidence_score", "unique_id",
        "fixture_id",
        "match_status", "actual_result", "bet_result", "primera_cuota",
        "primera_fecha_hora", "ultima_cuota", "ultima_fecha_hora",
        "closing_odd", "clv_percentage", "clv_label"
    ]
    now_str = current_time.strftime('%Y-%m-%d %H:%M')
    # Índices existentes
    existing_by_uid = {row["unique_id"]: row for row in existing_rows if row.get("unique_id")}
    # Índice secundario por (fixture_id, market, selection) para evitar duplicados reales
    existing_by_fixture_market_sel = {}
    for row in existing_rows:
        key = (row.get("fixture_id", ""), row.get("market", ""), row.get("selection", ""))
        if key[0]:  # Solo si tiene fixture_id
            existing_by_fixture_market_sel[key] = row

    added_count = 0
    updated_count = 0
    for new_data in rows_to_process:
        uid = new_data["unique_id"]
        fixture_id = new_data.get("fixture_id", "")
        market = new_data["market"]
        selection = new_data["selection"]
        current_odd = round(new_data["betfair_odd"], 2)
        match_dt = new_data["match_dt"]

        # Primero intentar por unique_id
        row = existing_by_uid.get(uid)
        # Si no, fallback por (fixture_id, market, selection)
        if not row and fixture_id:
            key = (fixture_id, market, selection)
            row = existing_by_fixture_market_sel.get(key)

        if row:
            if match_dt <= current_time + timedelta(minutes=15):
                print(f"[CSV] ⏸️ Partido ya empezado: {new_data['home_team']} vs {new_data['away_team']}")
                continue
            last_odd_str = row.get("ultima_cuota", "0").strip()
            last_odd = float(last_odd_str) if last_odd_str else 0.0
            last_odd = round(last_odd, 2)
            updated = False
            if abs(last_odd - current_odd) >= 0.01:
                print(f"[CSV] 🔄 Actualizando cuota: {new_data['home_team']} vs {new_data['away_team']}: {last_odd:.2f} → {current_odd:.2f}")
                updated = True
            row["ultima_cuota"] = f"{current_odd:.2f}"
            row["ultima_fecha_hora"] = now_str
            new_conf = str(round(new_data.get("confidence_score", 0), 1))
            old_conf = row.get("confidence_score", "N/A")
            if new_conf != "0.0" and new_conf != old_conf and new_conf != "N/A":
                print(f"[CSV] 🎯 Confidence actualizado: {old_conf} → {new_conf} | {new_data['home_team']} vs {new_data['away_team']}")
                row["confidence_score"] = new_conf
                updated = True
            # Actualizar edge_actual (edge_inicial se mantiene siempre)
            current_edge_actual = float(row.get("edge_actual", 0))
            if abs(current_edge_actual - new_data["edge"]) > 0.1:
                row["edge_actual"] = round(new_data["edge"], 2)
                print(f"[CSV] 📊 Edge actualizado: {current_edge_actual:.2f}% → {new_data['edge']:.2f}% | {new_data['home_team']} vs {new_data['away_team']}")
                updated = True
            # Forzar unique_id correcto (por si era antiguo/duplicado)
            row["unique_id"] = uid
            # Penalización de confidence si edge < min_edge requerido
            min_edge = min_edge_required(current_odd)
            if new_data["edge"] < min_edge:
                old_conf_val = float(row.get("confidence_score", 0) or 0)
                new_conf_val = round(old_conf_val * 0.75, 1)
                row["confidence_score"] = str(new_conf_val)
                print(f"[CSV] ⚠️ Penalizando confidence por pérdida de value: {old_conf_val} → {new_conf_val} | {new_data['home_team']} vs {new_data['away_team']}")
            if updated or row.get("ultima_fecha_hora") != now_str:
                row["modified"] = True
                updated_count += 1
        else:
            new_row = {
                "execution_date": new_data["execution_date"],
                "match_date": new_data["match_date"],
                "league": new_data["league"],
                "home_team": new_data["home_team"],
                "away_team": new_data["away_team"],
                "market": new_data["market"],
                "selection": new_data["selection"],
                "betfair_odd": f"{current_odd:.2f}",
                "model_prob_raw": new_data["model_prob_raw"],
                "model_prob_calibrated": new_data.get("model_prob_calibrated", new_data["model_prob_raw"]),
                "fair_odd": new_data["fair_odd"],
                "edge_inicial": new_data["edge"],  # Edge inicial se guarda aquí
                "edge_actual": new_data["edge"],   # Edge actual empieza igual
                "kelly": new_data["kelly"],
                "model_used": new_data["model_used"],
                "confidence_score": str(round(new_data.get("confidence_score", 0), 1)),
                "unique_id": uid,
                "fixture_id": new_data.get("fixture_id", ""),
                "match_status": "",
                "actual_result": "",
                "bet_result": "",
                "primera_cuota": f"{current_odd:.2f}",
                "primera_fecha_hora": now_str,
                "ultima_cuota": f"{current_odd:.2f}",
                "ultima_fecha_hora": now_str,
                "closing_odd": "",
                "clv_percentage": "",
                "clv_label": "",
                "modified": True
            }
            existing_rows.append(new_row)
            existing_by_uid[uid] = new_row
            if fixture_id:
                existing_by_fixture_market_sel[(fixture_id, market, selection)] = new_row
            added_count += 1
            print(f"[CSV] ✅ Nueva: {new_data['home_team']} vs {new_data['away_team']} - {new_data['selection']} @ {current_odd} | Conf: {new_row['confidence_score']}")
    clean_rows = []
    for row in existing_rows:
        clean_row = {k: v for k, v in row.items() if k in fieldnames}
        if "confidence_score" not in clean_row or not clean_row["confidence_score"]:
            clean_row["confidence_score"] = "N/A"
        if "fixture_id" not in clean_row:
            clean_row["fixture_id"] = ""
        if "closing_odd" not in clean_row:
            clean_row["closing_odd"] = ""
        if "clv_percentage" not in clean_row:
            clean_row["clv_percentage"] = ""
        if "clv_label" not in clean_row:
            clean_row["clv_label"] = ""
        # Asegurar que edge_inicial y edge_actual existan
        if "edge_inicial" not in clean_row or not clean_row["edge_inicial"]:
            clean_row["edge_inicial"] = ""
        if "edge_actual" not in clean_row or not clean_row["edge_actual"]:
            clean_row["edge_actual"] = ""
        clean_rows.append(clean_row)
    with open(HISTORY_CSV, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(clean_rows)
    if added_count > 0 or updated_count > 0:
        print(f"[CSV] 📊 Resumen: {added_count} nuevas, {updated_count} actualizadas.")
        return True
    return False
def get_closing_odd(fixture_id, market_type, selection):
    """
    Obtiene la closing odd SOLO de Betfair (bookmaker_id=3)
    SOLO para mercados 5 (Over/Under 2.5) y 8 (BTTS)
    """
    try:
        if not fixture_id:
            print(f"[CLV] ❌ fixture_id vacío")
            return None
        
        try:
            fixture_id_clean = int(fixture_id) if isinstance(fixture_id, str) else fixture_id
        except (ValueError, TypeError):
            print(f"[CLV] ❌ fixture_id inválido: {fixture_id}")
            return None
        
        url = f"https://v3.football.api-sports.io/odds?fixture={fixture_id_clean}&bookmaker=3"
        print(f"[CLV] 🔍 Buscando closing odd para fixture {fixture_id_clean}...")
        
        data = api_get(url)
        
        if not data.get("response") or len(data.get("response", [])) == 0:
            print(f"[CLV] ⚠️ Sin datos para fixture {fixture_id_clean}")
            return None
        
        for game in data["response"]:
            for bookmaker in game.get("bookmakers", []):
                if bookmaker.get("id") != 3:
                    continue
                
                for bet in bookmaker.get("bets", []):
                    bet_id = bet.get("id")
                    
                    if bet_id not in [5, 8]:
                        continue
                    
                    # Mercado 5: Over/Under 2.5
                    if market_type == "Over/Under 2.5" and bet_id == 5:
                        for value in bet.get("values", []):
                            val_name = value.get("value", "")
                            
                            try:
                                odd = float(value.get("odd", 0))
                                
                                # MEJORA: Matching con regex (más robusto para closing odds)
                                # Crítico para CLV: captura más variaciones de nombres
                                if OVER_25_PATTERN.search(val_name) and selection == "Over 2.5":
                                    print(f"[CLV] ✅ Closing '{val_name}' → Over 2.5: {odd:.2f}")
                                    return odd
                                elif UNDER_25_PATTERN.search(val_name) and selection == "Under 2.5":
                                    print(f"[CLV] ✅ Closing '{val_name}' → Under 2.5: {odd:.2f}")
                                    return odd
                            
                            except (ValueError, TypeError):
                                continue
                    
                    # Mercado 8: BTTS
                    elif market_type == "BTTS" and bet_id == 8:
                        for value in bet.get("values", []):
                            val_name = value.get("value", "")
                            
                            try:
                                odd = float(value.get("odd", 0))
                                
                                # MEJORA: Matching con regex (crítico para CLV)
                                # Detecta más variaciones de closing odds
                                if BTTS_YES_PATTERN.search(val_name) and selection == "BTTS Yes":
                                    print(f"[CLV] ✅ Closing '{val_name}' → BTTS Yes: {odd:.2f}")
                                    return odd
                                elif BTTS_NO_PATTERN.search(val_name) and selection == "BTTS No":
                                    print(f"[CLV] ✅ Closing '{val_name}' → BTTS No: {odd:.2f}")
                                    return odd
                            
                            except (ValueError, TypeError):
                                continue
        
        print(f"[CLV] ❌ No se encontró closing odd para {selection}")
        return None
    
    except Exception as e:
        print(f"[CLV] ❌ Error: {e}")
        return None


def calculate_clv_metrics(primera_cuota, closing_odd):
    if not primera_cuota or not closing_odd or primera_cuota == 0:
        return None, "N/A"
    clv = ((primera_cuota / closing_odd) - 1) * 100
    if clv >= 5:
        label = "Excelente"
    elif clv >= 2:
        label = "Bueno"
    elif clv >= -2:
        label = "Neutro"
    elif clv >= -5:
        label = "Regular"
    else:
        label = "Malo"
    return round(clv, 2), label
def update_past_bets(existing_rows):
    now = datetime.now(timezone.utc)
    updated_count = 0
    for row in existing_rows:
        if row.get("bet_result", "").strip():
            continue  # Ya resuelto

        match_dt = parse_date_flexible(row["match_date"])
        if match_dt is None:
            print(f"[UPDATE] ⚠️ Fecha no parseable, saltando: {row['home_team']} vs {row['away_team']}")
            continue

        fixture_id_str = row.get("fixture_id", "").strip()
        if not fixture_id_str:
            print(f"[UPDATE] ⚠️ Sin fixture_id en CSV, no se puede actualizar: {row['home_team']} vs {row['away_team']}")
            continue

        fixture_id = int(fixture_id_str) if fixture_id_str.isdigit() else fixture_id_str

        url = f"https://v3.football.api-sports.io/fixtures?id={fixture_id}"
        data = api_get(url)

        if not data.get("response") or len(data["response"]) == 0:
            print(f"[UPDATE] ❌ No encontrado fixture_id {fixture_id}: {row['home_team']} vs {row['away_team']}")
            continue

        fixture = data["response"][0]
        status = fixture.get("fixture", {}).get("status", {}).get("short", "")

        # === CLAVE: Solo actualizar si la API dice que está terminado ===
        if status != "FT":
            print(f"[UPDATE] ⏳ Partido NO finalizado (status: {status}), saltando: {row['home_team']} vs {row['away_team']}")
            continue

        goals_home = fixture["goals"]["home"]
        goals_away = fixture["goals"]["away"]

        if goals_home is None or goals_away is None:
            print(f"[UPDATE] ⚠️ Goles aún None aunque status FT → saltando (posible delay API): {row['home_team']} vs {row['away_team']}")
            continue

        goals_home = int(goals_home)
        goals_away = int(goals_away)

        print(f"[UPDATE] ✅ Actualizando partido FINALIZADO: {row['home_team']} vs {row['away_team']} | Resultado: {goals_home}-{goals_away}")

        row["actual_result"] = f"'{goals_home}-{goals_away}"
        row["match_status"] = "FT"

        market = row["market"]
        selection = row["selection"]
        won = False

        if market == "Over/Under 2.5":
            total = goals_home + goals_away
            if selection == "Over 2.5" and total > 2.5:
                won = True
            elif selection == "Under 2.5" and total <= 2.5:
                won = True
        elif market == "BTTS":
            if selection == "BTTS Yes" and goals_home >= 1 and goals_away >= 1:
                won = True
            elif selection == "BTTS No" and (goals_home == 0 or goals_away == 0):
                won = True

        row["bet_result"] = "Ganada" if won else "Perdida"
        print(f"[UPDATE] 🎯 Resultado apuesta: {'Ganada ✅' if won else 'Perdida ❌'}")

        # Closing odd
        print(f"[UPDATE] 🔍 Buscando closing odd real para fixture {fixture_id}...")
        closing_odd = get_closing_odd(fixture_id, market, selection)

        primera_cuota_str = row.get("primera_cuota", "").strip()
        primera_cuota = float(primera_cuota_str) if primera_cuota_str else 0.0

        if closing_odd:
            row["closing_odd"] = f"{closing_odd:.2f}"
            clv_percentage, clv_label = calculate_clv_metrics(primera_cuota, closing_odd)
            print(f"[UPDATE] 📈 Closing real encontrada: {closing_odd:.2f} | CLV: {clv_percentage:+.2f}% ({clv_label})")
        else:
            # Fallback a última cuota conocida (muy buena aproximación para closing)
            ultima_str = row.get("ultima_cuota", "").strip()
            if ultima_str and ultima_str not in ["0", "N/A", ""]:
                fallback_closing = float(ultima_str)
                row["closing_odd"] = f"{fallback_closing:.2f}"
                clv_percentage, clv_label = calculate_clv_metrics(primera_cuota, fallback_closing)
                print(f"[UPDATE] 📉 Sin closing real → usando última cuota como proxy: {fallback_closing:.2f} | CLV: {clv_percentage:+.2f}% ({clv_label})")
            else:
                row["closing_odd"] = "N/A"
                clv_percentage, clv_label = None, "N/A"
                print(f"[UPDATE] ⚠️ No hay closing ni última cuota disponible → CLV N/A")

        if clv_percentage is not None:
            row["clv_percentage"] = f"{clv_percentage:+.2f}%" if clv_percentage is not None else "N/A"
            row["clv_label"] = clv_label

        row["modified"] = True
        updated_count += 1

        time.sleep(1)  # Respeto rate limit

    if updated_count > 0:
        print(f"[UPDATE] ✅ Se actualizaron {updated_count} partidos concluidos.")
    else:
        print(f"[UPDATE] ℹ️ No había partidos terminados pendientes de actualizar.")
def recalculate_confidence_for_existing(existing_rows, dc_params):
    updated = 0
    for row in existing_rows:
        if row.get("bet_result", "").strip():
            continue
        try:
            league_name = row["league"].strip()
            league_id = {
                "Premier League": 39, "Championship": 40, "La Liga": 140, "Segunda División": 141,
                "Serie A": 135, "Serie B": 136, "Bundesliga": 78, "2. Bundesliga": 79,
                "Ligue 1": 61, "Ligue 2": 62, "Eredivisie": 88,
                "Scottish Premiership": 179, "Primeira Liga": 94,
                "Jupiler Pro League": 144, "Super League": 207
            }.get(league_name)
            if not league_id:
                continue
            model_prob_cal = float(row.get("model_prob_calibrated", 0))
            betfair_odd = float(row.get("betfair_odd", 0))
            edge = float(row.get("edge_actual") or row.get("edge", 0) or 0)
            if model_prob_cal == 0 or betfair_odd == 0:
                continue
            market_prob = 100 / betfair_odd
            diff = abs(model_prob_cal - market_prob)
            dc_param = dc_params.get(league_id)
            dc_quality = 0.8 if dc_param and dc_param.get("n_matches", 0) >= 50 else 0.6
            confidence = (
                min(edge, 15) * 3.5 +
                (dc_quality * 100) * 0.35 +
                max(0, 100 - diff) * 0.15
            )
            if edge < 7:
                confidence *= 0.85
            if dc_quality < 0.7:
                confidence *= 0.9
            confidence = round(min(confidence, 100), 1)
            row["confidence_score"] = confidence
            row["modified"] = True
            updated += 1
            print(f"[CONFIDENCE] Actualizado: {row['home_team']} vs {row['away_team']} → {confidence}%")
        except Exception as e:
            print(f"[CONFIDENCE] Error: {e}")
            continue
    if updated > 0:
        print(f"[CONFIDENCE] {updated} filas actualizadas con confidence_score.")
    return updated
def calculate_performance_stats(existing_rows, bankroll_inicial):
    resolved = [row for row in existing_rows if row.get("bet_result") in ["Ganada", "Perdida"]]
    if not resolved:
        return None, None, None, None, 0
    # Fallback para sort si alguna fecha no se parsea
    min_date = datetime(1900, 1, 1, tzinfo=timezone.utc)
    resolved.sort(key=lambda r: parse_date_flexible(r["match_date"]) or min_date)
    use_kelly = bankroll_inicial > 0
    bankroll = bankroll_inicial if use_kelly else None
    total_turnover = total_beneficio = ganadas = 0.0
    for row in resolved:
        odd = float(row["betfair_odd"])
        kelly_pct = float(row.get("kelly", 0))
        won = row["bet_result"] == "Ganada"
        stake = round((kelly_pct / 100.0) * bankroll, 2) if use_kelly else FALLBACK_STAKE_FLAT
        beneficio = stake * (odd - 1) if won else -stake
        if use_kelly:
            bankroll = round(bankroll + beneficio, 2)
        total_turnover += stake
        total_beneficio += beneficio
        if won:
            ganadas += 1
    num_resolved = len(resolved)
    win_rate = round((ganadas / num_resolved) * 100, 1) if num_resolved > 0 else 0
    yield_pct = round((total_beneficio / total_turnover) * 100, 2) if total_turnover > 0 else 0.0
    roi = round(((bankroll - bankroll_inicial) / bankroll_inicial) * 100, 2) if use_kelly else None
    bankroll_final = round(bankroll, 2) if use_kelly else None
    return win_rate, yield_pct, roi, bankroll_final, num_resolved
def calculate_clv_stats(existing_rows):
    rows_with_clv = [
        row for row in existing_rows
        if row.get("clv_percentage", "N/A") not in ["N/A", ""]
        and row.get("bet_result") in ["Ganada", "Perdida"]
    ]
    if not rows_with_clv:
        return None
    clv_values = []
    for row in rows_with_clv:
        try:
            clv_str = row["clv_percentage"].replace("%", "").replace("+", "")
            clv_val = float(clv_str)
            clv_values.append(clv_val)
        except:
            continue
    if not clv_values:
        return None
    avg_clv = sum(clv_values) / len(clv_values)
    positive_clv = sum(1 for c in clv_values if c > 2)
    total = len(clv_values)
    return {
        "avg_clv": round(avg_clv, 2),
        "positive_clv_count": positive_clv,
        "positive_clv_rate": round((positive_clv / total) * 100, 1),
        "total_with_clv": total
    }
def get_fixtures_for_date(league_id, date_str):
    """
    Obtiene fixtures con GARANTÍA de fixture_id válido
    """
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}&date={date_str}"
    data = api_get(url)
    fixtures = {}
    
    for f in data.get("response", []):
        # CORRECCIÓN: Asegurar que fixture_id siempre se extrae correctamente
        fixture_id = f.get("fixture", {}).get("id")
        
        if not fixture_id:
            print(f"[FIXTURES] ⚠️ Fixture sin ID, saltando")
            continue
        
        # Convertir a string para consistencia
        fixture_id_str = str(fixture_id)
        
        fixtures[fixture_id_str] = {
            "home": f["teams"]["home"],
            "away": f["teams"]["away"],
            "date": f["fixture"]["date"],
            "league_name": f["league"]["name"],
            "fixture_id": fixture_id  # Guardar también como int
        }
        
        print(f"[FIXTURES] ✅ Cargado fixture {fixture_id_str}: {f['teams']['home']['name']} vs {f['teams']['away']['name']}")
    
    return fixtures

def get_team_form_indicator(team_id, league_id, n_matches=5):
    cache_key = f"form_{team_id}{league_id}{SEASON}"
    if cache_key in cache["form"]:
        return cache["form"][cache_key]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d")
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}&team={team_id}&from={start_date}&to={today}&status=FT"
    data = api_get(url)
    matches = data.get("response", [])
    if not matches:
        return 0.5
    matches.sort(key=lambda x: x["fixture"]["date"], reverse=True)
    recent = matches[:n_matches]
    points = total_games = goal_diff = 0
    for m in recent:
        home_id = m["teams"]["home"]["id"]
        goals_home = m["goals"]["home"]
        goals_away = m["goals"]["away"]
        if goals_home is None or goals_away is None:
            continue
        total_games += 1
        if home_id == team_id:
            goal_diff += (goals_home - goals_away)
            if goals_home > goals_away: points += 3
            elif goals_home == goals_away: points += 1
        else:
            goal_diff += (goals_away - goals_home)
            if goals_away > goals_home: points += 3
            elif goals_away == goals_home: points += 1
    if total_games == 0:
        return 0.5
    max_points = total_games * 3
    form_score = (points / max_points) * 0.7 + (min(max(goal_diff, -5), 5) / 10 + 0.5) * 0.3
    cache["form"][cache_key] = form_score
    save_cache()
    return form_score
def get_h2h_stats(home_id, away_id, league_id, n_matches=5):
    cache_key = f"h2h_{home_id}{away_id}{league_id}"
    if cache_key in cache["h2h"]:
        return cache["h2h"][cache_key]
    url = f"https://v3.football.api-sports.io/fixtures/headtohead?h2h={home_id}-{away_id}&last={n_matches}"
    data = api_get(url)
    matches = data.get("response", [])
    if len(matches) < 2:
        return None
    home_goals_avg = away_goals_avg = count = 0
    for m in matches:
        if m["goals"]["home"] is None:
            continue
        h_id = m["teams"]["home"]["id"]
        if h_id == home_id:
            home_goals_avg += m["goals"]["home"]
            away_goals_avg += m["goals"]["away"]
        else:
            home_goals_avg += m["goals"]["away"]
            away_goals_avg += m["goals"]["home"]
        count += 1
    if count == 0:
        return None
    # MEJORA #1: Calcular calidad del H2H basada en cantidad de partidos
    # Máxima confianza con 5+ partidos, mínima con 2
    quality = min(count / 5.0, 1.0)
    result = {
        "home_goals_avg": home_goals_avg / count, 
        "away_goals_avg": away_goals_avg / count, 
        "n_matches": count,
        "quality": quality  # NUEVO: indica confiabilidad del dato
    }
    cache["h2h"][cache_key] = result
    save_cache()
    return result
def get_weighted_team_stats(team_id, league_id):
    params = LEAGUE_PARAMS.get(league_id, DEFAULT_PARAMS)
    xi_decay = params["xi_decay"]
    key = f"weighted_{team_id}{league_id}{SEASON}"
    if key in cache["teams"]:
        cached_result = cache["teams"][key]
        # V4.2 FIX: Asegurar que team_id siempre esté presente
        if "team_id" not in cached_result:
            cached_result["team_id"] = team_id
        return cached_result
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = f"{SEASON}-08-01"
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}&from={start_date}&to={today}"
    data = api_get(url)
    fixtures = data.get("response", [])
    if not fixtures:
        return {"team_id": team_id, "gf_home": 1.35, "ga_home": 1.35, "gf_away": 1.20, "ga_away": 1.35, "matches": 0}
    weighted_gf_home = weighted_ga_home = weighted_gf_away = weighted_ga_away = 0.0
    total_weight_home = total_weight_away = n_matches_home = n_matches_away = 0.0
    current_dt = datetime.now(timezone.utc)
    for f in fixtures:
        try:
            fixture_dt = datetime.fromisoformat(f["fixture"]["date"].replace("Z", "+00:00"))
            days_ago = (current_dt - fixture_dt).days
            if days_ago < 0: continue
            weight = math.exp(-xi_decay * days_ago)
            home_id = f["teams"]["home"]["id"]
            away_id = f["teams"]["away"]["id"]
            goals_home = f["goals"]["home"] if f["goals"]["home"] is not None else 0
            goals_away = f["goals"]["away"] if f["goals"]["away"] is not None else 0
            if home_id == team_id:
                weighted_gf_home += goals_home * weight
                weighted_ga_home += goals_away * weight
                total_weight_home += weight
                n_matches_home += 1
            elif away_id == team_id:
                weighted_gf_away += goals_away * weight
                weighted_ga_away += goals_home * weight
                total_weight_away += weight
                n_matches_away += 1
        except:
            continue
    gf_home = weighted_gf_home / total_weight_home if total_weight_home > 0 else 1.35
    ga_home = weighted_ga_home / total_weight_home if total_weight_home > 0 else 1.35
    gf_away = weighted_gf_away / total_weight_away if total_weight_away > 0 else 1.20
    ga_away = weighted_ga_away / total_weight_away if total_weight_away > 0 else 1.35
    
    # V4.2: Incluir team_id para features H2H
    result = {
        "team_id": team_id,
        "gf_home": gf_home, 
        "ga_home": ga_home, 
        "gf_away": gf_away, 
        "ga_away": ga_away, 
        "matches": n_matches_home + n_matches_away
    }
    cache["teams"][key] = result
    save_cache()
    return result
def get_all_historical_matches(league_id):
    cache_key = f"hist_matches_{league_id}_{SEASON}"
    if cache_key in cache["leagues"]:
        return cache["leagues"][cache_key]
    params = LEAGUE_PARAMS.get(league_id, DEFAULT_PARAMS)
    xi_decay = params["xi_decay"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_date = f"{SEASON}-08-01"
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}&from={start_date}&to={today}&status=FT"
    data = api_get(url)
    fixtures = data.get("response", [])
    matches = []
    current_dt = datetime.now(timezone.utc)
    for f in fixtures:
        try:
            h_id = f["teams"]["home"]["id"]
            a_id = f["teams"]["away"]["id"]
            h_g = int(f["goals"]["home"] or 0)
            a_g = int(f["goals"]["away"] or 0)
            dt = datetime.fromisoformat(f["fixture"]["date"].replace("Z", "+00:00"))
            days_ago = max(0, (current_dt - dt).days)
            weight = math.exp(-xi_decay * days_ago)
            matches.append((h_id, a_id, h_g, a_g, weight))
        except:
            continue
    cache["leagues"][cache_key] = matches
    save_cache()
    return matches
def dc_log_likelihood(params, home_idx, away_idx, home_goals, away_goals, weights, n_teams, lambda_reg):
    attack = params[:n_teams]
    defence = params[n_teams:2*n_teams]
    home_adv = params[-1]
    lambda_h = np.exp(attack[home_idx] + defence[away_idx] + home_adv)
    lambda_a = np.exp(attack[away_idx] + defence[home_idx])
    log_lik = np.sum(weights * (poisson.logpmf(home_goals, lambda_h) + poisson.logpmf(away_goals, lambda_a)))
    mean_attack = np.mean(attack)
    mean_defence = np.mean(defence)
    log_lik -= lambda_reg * (np.sum((attack - mean_attack)**2) + np.sum((defence - mean_defence)**2))
    return -log_lik
def dc_rho_likelihood(rho_scalar, home_idx, away_idx, home_goals, away_goals, weights, attack, defence, home_adv):
    rho = rho_scalar[0]
    lambda_h = np.exp(attack[home_idx] + defence[away_idx] + home_adv)
    lambda_a = np.exp(attack[away_idx] + defence[home_idx])
    base = poisson.pmf(home_goals, lambda_h) * poisson.pmf(away_goals, lambda_a)
    adj = np.ones_like(base)
    mask00 = (home_goals == 0) & (away_goals == 0)
    mask01 = (home_goals == 0) & (away_goals == 1)
    mask10 = (home_goals == 1) & (away_goals == 0)
    mask11 = (home_goals == 1) & (away_goals == 1)
    adj[mask00] = 1 - lambda_h[mask00] * lambda_a[mask00] * rho
    adj[mask01] = 1 + lambda_h[mask01] * rho
    adj[mask10] = 1 + lambda_a[mask10] * rho
    adj[mask11] = 1 - rho
    p = base * adj
    return -np.sum(weights * np.log(np.maximum(p, 1e-10)))
def get_dc_parameters(league_id, target_market="general"):
    """
    Obtiene parámetros Dixon-Coles optimizados para un mercado específico.
    
    MEJORA: Modelos separados para Over/Under/BTTS
    - Over necesita rho menos negativo (partidos más abiertos)
    - Under necesita rho más negativo (partidos más cerrados)
    - BTTS usa parámetros intermedios
    
    Args:
        league_id: ID de la liga
        target_market: "over", "under", "btts", o "general"
    
    Returns:
        dict con parámetros DC o None si no hay suficientes datos
    """
    # Seleccionar parámetros según mercado objetivo
    if target_market == "over":
        params = LEAGUE_PARAMS_OVER.get(league_id, DEFAULT_PARAMS_OVER)
        cache_dict = cache["dc_params_over"]
        cache_key = f"dc_params_over_{league_id}_{SEASON}"
    elif target_market == "under":
        params = LEAGUE_PARAMS_UNDER.get(league_id, DEFAULT_PARAMS_UNDER)
        cache_dict = cache["dc_params_under"]
        cache_key = f"dc_params_under_{league_id}_{SEASON}"
    elif target_market == "btts":
        params = LEAGUE_PARAMS_BTTS.get(league_id, DEFAULT_PARAMS_BTTS)
        cache_dict = cache["dc_params_btts"]
        cache_key = f"dc_params_btts_{league_id}_{SEASON}"
    else:  # general (backward compatibility)
        params = LEAGUE_PARAMS.get(league_id, DEFAULT_PARAMS)
        cache_dict = cache["dc_params"]
        cache_key = f"dc_params_{league_id}_{SEASON}"
    
    lambda_reg = params["lambda_reg"]
    min_matches = params["min_matches"]
    rho_prior = params["rho_prior"]
    
    # Check cache
    if cache_key in cache_dict:
        return cache_dict[cache_key]
    
    matches = get_all_historical_matches(league_id)
    if len(matches) < min_matches:
        return None
    home_ids, away_ids, h_g, a_g, w = zip(*matches)
    home_ids = np.array(home_ids)
    away_ids = np.array(away_ids)
    home_goals = np.array(h_g)
    away_goals = np.array(a_g)
    weights = np.array(w)
    all_teams = np.unique(np.concatenate([home_ids, away_ids]))
    team_to_idx = {tid: i for i, tid in enumerate(all_teams)}
    n_teams = len(all_teams)
    home_idx = np.array([team_to_idx[tid] for tid in home_ids])
    away_idx = np.array([team_to_idx[tid] for tid in away_ids])
    init_attack = np.zeros(n_teams)
    init_defence = np.zeros(n_teams)
    for tid, i in team_to_idx.items():
        stats = get_weighted_team_stats(tid, league_id)
        gf = max((stats["gf_home"] + stats["gf_away"]) / 2, 0.3)
        ga = max((stats["ga_home"] + stats["ga_away"]) / 2, 0.3)
        init_attack[i] = np.log(gf)
        init_defence[i] = np.log(ga)
    initial_params = np.concatenate([init_attack, init_defence, [params["home_adv"]]])
    bounds = [(-1.5, 1.5)] * (2 * n_teams) + [(0.0, 0.6)]
    res1 = minimize(dc_log_likelihood, initial_params,
                    args=(home_idx, away_idx, home_goals, away_goals, weights, n_teams, lambda_reg),
                    method='L-BFGS-B', bounds=bounds, options={'ftol': 1e-10, 'maxiter': 2000})
    if not res1.success:
        return None
    params_opt = res1.x
    attack = params_opt[:n_teams]
    defence = params_opt[n_teams:2*n_teams]
    home_adv = params_opt[-1]
    mean_attack = np.mean(attack)
    attack -= mean_attack
    defence += mean_attack
    res2 = minimize(dc_rho_likelihood, x0=np.array([rho_prior]),
                    args=(home_idx, away_idx, home_goals, away_goals, weights, attack, defence, home_adv),
                    method='L-BFGS-B', bounds=[(-0.5, 0.2)])
    rho = res2.x[0] if res2.success else rho_prior
    result = {
        "team_ids": all_teams.tolist(),
        "team_to_idx": team_to_idx,
        "attack": attack.tolist(),
        "defence": defence.tolist(),
        "home_adv": float(home_adv),
        "rho": float(rho),
        "n_matches": len(matches),
        "target_market": target_market  # NUEVO: registrar para qué mercado se optimizó
    }
    cache_dict[cache_key] = result
    save_cache()
    return result
def calculate_form_adjustment(form_score):
    """
    MEJORA #2: Ajuste asimétrico por forma
    - Buena forma (0.5-1.0): +0% a +10% (crecimiento limitado)
    - Mala forma (0.0-0.5): -0% a -20% (penalización mayor)
    
    Rationale: Los equipos en mala forma tienden a tener peor rendimiento
    más pronunciado que el bonus de equipos en buena forma.
    """
    if form_score >= 0.5:
        # Buena forma: crecimiento moderado
        return 1 + (form_score - 0.5) * 0.20  # Máximo +10%
    else:
        # Mala forma: penalización más agresiva
        return 1 + (form_score - 0.5) * 0.40  # Máximo -20%

def match_probabilities_enhanced(lambda_h, lambda_a, rho=-0.08):
    goals = np.arange(MAX_GOALS + 1)
    pmf_h = poisson.pmf(goals, lambda_h)
    pmf_a = poisson.pmf(goals, lambda_a)
    base_matrix = np.outer(pmf_h, pmf_a)
    h_grid, a_grid = np.meshgrid(goals, goals, indexing='ij')
    adj = np.ones_like(base_matrix)
    mask00 = (h_grid == 0) & (a_grid == 0)
    mask01 = (h_grid == 0) & (a_grid == 1)
    mask10 = (h_grid == 1) & (a_grid == 0)
    mask11 = (h_grid == 1) & (a_grid == 1)
    adj[mask00] = 1 - lambda_h * lambda_a * rho
    adj[mask01] = 1 + lambda_h * rho
    adj[mask10] = 1 + lambda_a * rho
    adj[mask11] = 1 - rho
    prob_matrix = base_matrix * adj
    prob_matrix = prob_matrix / np.sum(prob_matrix)
    total_goals = h_grid + a_grid
    over25 = np.sum(prob_matrix[total_goals > 2.5])
    under25 = 1.0 - over25
    btts_yes = np.sum(prob_matrix[(h_grid >= 1) & (a_grid >= 1)])
    btts_no = 1.0 - btts_yes
    return {"over25": over25 * 100, "under25": under25 * 100, "btts_yes": btts_yes * 100, "btts_no": btts_no * 100}
def calibrate_probability(model_prob, market_prob, alpha=CALIBRATION_ALPHA, beta=CALIBRATION_BETA):
    return alpha * model_prob + beta * market_prob
def calculate_confidence_score(model_prob, market_prob, edge, dc_quality=1.0, h2h_available=False, form_diff=0):
    diff = abs(model_prob - market_prob)
    confidence = (
        min(edge, 15) * 3.5 +
        (dc_quality * 100) * 0.35 +
        max(0, 100 - diff) * 0.15
    )
    if edge < 7:
        confidence *= 0.85
    if dc_quality < 0.7:
        confidence *= 0.9
    confidence = round(min(confidence, 100), 1)
    return confidence
def kelly_fractional(prob, odd, fractional=FRACTIONAL_KELLY):
    p = prob / 100.0
    if p <= 0 or odd <= 1 or p >= 1:
        return 0.0
    full_kelly = (p * odd - 1) / (odd - 1)
    if full_kelly <= 0:
        return 0.0
    stake = full_kelly * fractional
    return round(min(stake, 0.25) * 100, 1)
def get_current_odd(fixture_id, market=None, selection=None):
    """
    OPTIMIZADO: Una sola llamada API que devuelve TODOS los mercados Betfair.
    
    COMPATIBILIDAD: Acepta los parámetros antiguos (market, selection) pero los ignora.
    Siempre devuelve los 4 mercados a la vez.
    
    Args:
        fixture_id: ID del partido
        market: (IGNORADO - mantener compatibilidad)
        selection: (IGNORADO - mantener compatibilidad)
    
    ANTES: 4 llamadas separadas (Over, Under, BTTS Yes, BTTS No)
    AHORA: 1 llamada total
    AHORRO: 75% de llamadas API
    
    Returns:
        dict: {
            "over25": (odd, bookmaker_name) or (None, None),
            "under25": (odd, bookmaker_name) or (None, None),
            "btts_yes": (odd, bookmaker_name) or (None, None),
            "btts_no": (odd, bookmaker_name) or (None, None)
        }
    """
    # Validar fixture_id
    if not fixture_id:
        print(f"[ODD] ❌ fixture_id vacío")
        return {
            "over25": (None, None),
            "under25": (None, None),
            "btts_yes": (None, None),
            "btts_no": (None, None)
        }
    
    try:
        fixture_id_clean = int(fixture_id) if isinstance(fixture_id, str) else fixture_id
    except (ValueError, TypeError):
        print(f"[ODD] ❌ fixture_id inválido: {fixture_id}")
        return {
            "over25": (None, None),
            "under25": (None, None),
            "btts_yes": (None, None),
            "btts_no": (None, None)
        }
    
    # UNA SOLA LLAMADA API para todos los mercados
    url = f"https://v3.football.api-sports.io/odds?fixture={fixture_id_clean}&bookmaker=3"
    print(f"[ODD] 🔍 Consultando fixture {fixture_id_clean}...")
    
    data = api_get(url)
    
    # Inicializar resultado
    result = {
        "over25": (None, None),
        "under25": (None, None),
        "btts_yes": (None, None),
        "btts_no": (None, None)
    }
    
    if not data.get("response") or len(data.get("response", [])) == 0:
        print(f"[ODD] ⚠️ Sin datos Betfair para fixture {fixture_id_clean}")
        return result
    
    for game in data["response"]:
        for bookmaker in game.get("bookmakers", []):
            # FILTRO: Solo Betfair (id=3)
            if bookmaker.get("id") != 3:
                continue
            
            book_name = bookmaker.get("name", "Betfair")
            
            for bet in bookmaker.get("bets", []):
                bet_id = bet.get("id")
                
                # Mercado 5: Goals Over/Under (solo 2.5)
                if bet_id == 5:
                    for v in bet.get("values", []):
                        val_name = v.get("value", "")
                        
                        try:
                            odd = float(v.get("odd"))
                            
                            # MEJORA: Matching con regex (más robusto)
                            # Detecta variaciones: "Over 2.5", "Over (2.5)", "Over25", "Over 2.5 Goals", etc.
                            # Evita falsos positivos: "discover", "coverage", etc.
                            if OVER_25_PATTERN.search(val_name):
                                result["over25"] = (odd, book_name)
                                print(f"[ODD] 📊 Encontrado '{val_name}' → Over 2.5: {odd:.2f}")
                            elif UNDER_25_PATTERN.search(val_name):
                                result["under25"] = (odd, book_name)
                                print(f"[ODD] 📊 Encontrado '{val_name}' → Under 2.5: {odd:.2f}")
                        
                        except (ValueError, TypeError):
                            continue
                
                # Mercado 8: Both Teams Score
                elif bet_id == 8:
                    for v in bet.get("values", []):
                        val_name = v.get("value", "")
                        
                        try:
                            odd = float(v.get("odd"))
                            
                            # MEJORA: Matching con regex (detecta más variaciones)
                            # Detecta: "Yes", "Si", "Sí", "Both Teams Score", etc.
                            if BTTS_YES_PATTERN.search(val_name):
                                result["btts_yes"] = (odd, book_name)
                                print(f"[ODD] 📊 Encontrado '{val_name}' → BTTS Yes: {odd:.2f}")
                            elif BTTS_NO_PATTERN.search(val_name):
                                result["btts_no"] = (odd, book_name)
                                print(f"[ODD] 📊 Encontrado '{val_name}' → BTTS No: {odd:.2f}")
                        
                        except (ValueError, TypeError):
                            continue
    
    # Log compacto del resultado
    found_count = sum(1 for v in result.values() if v[0] is not None)
    print(f"[ODD] ✅ {found_count}/4 mercados encontrados para fixture {fixture_id_clean}")
    
    if result["over25"][0]:
        print(f"  └─ Over 2.5: {result['over25'][0]:.2f}")
    if result["under25"][0]:
        print(f"  └─ Under 2.5: {result['under25'][0]:.2f}")
    if result["btts_yes"][0]:
        print(f"  └─ BTTS Yes: {result['btts_yes'][0]:.2f}")
    if result["btts_no"][0]:
        print(f"  └─ BTTS No: {result['btts_no'][0]:.2f}")
    
    return result

def run_bot():
    git_setup()
    git_pull()
    rows_to_save_or_update = []
    now = datetime.now(timezone.utc)
    execution_date = now.strftime('%Y-%m-%d %H:%M')
    
    # MEJORA #3: Calibración dinámica POR MERCADO basada en desempeño histórico
    calibrations = calculate_dynamic_calibration(HISTORY_CSV)
    print(f"[CALIBRATION] Calibraciones cargadas por mercado:")
    for market, (alpha, beta) in calibrations.items():
        print(f"  {market}: alpha={alpha:.2f}, beta={beta:.2f}")
    
    existing_rows = []
    existing_by_id = {}
    if os.path.exists(HISTORY_CSV):
        with open(HISTORY_CSV, mode='r', encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            for row in reader:
                row_copy = row.copy()
                row_copy["modified"] = False
                
                # MIGRACIÓN: Si existe columna "edge" antigua pero no edge_inicial/edge_actual, migrar
                if "edge" in row_copy and "edge_inicial" not in row_copy:
                    edge_value = row_copy["edge"]
                    row_copy["edge_inicial"] = edge_value
                    row_copy["edge_actual"] = edge_value
                    print(f"[CSV] 🔄 Migrando edge antiguo: {row_copy.get('home_team', '')} vs {row_copy.get('away_team', '')}")
                
                existing_rows.append(row_copy)
                uid = row.get("unique_id", "").strip()
                if uid:
                    existing_by_id[uid] = row_copy
        print(f"[CSV] Cargadas {len(existing_by_id)} apuestas existentes.")
    update_past_bets(existing_rows)
    win_rate, yield_pct, roi, bankroll_final, num_resolved = calculate_performance_stats(existing_rows, BANKROLL_INICIAL)
    clv_stats = calculate_clv_stats(existing_rows)
    stats_caption_extra = ""
    if num_resolved > 0:
        stats_caption_extra = (
            f"\n📈 Win rate: {win_rate}%\n"
            f"📈 Yield: {yield_pct:+.2f}%\n"
            f"📈 Bankroll: {BANKROLL_INICIAL:.2f} → {bankroll_final:.2f}\n"
            f"📈 ROI: {roi:+.2f}%\n"
            f"📈 Apuestas resueltas: {num_resolved}"
        )
        if clv_stats:
            stats_caption_extra += (
                f"\n\n📊 CLV Analysis:\n"
                f"📊 CLV Promedio: {clv_stats['avg_clv']:+.2f}%\n"
                f"📊 CLV Positivo: {clv_stats['positive_clv_count']}/{clv_stats['total_with_clv']} ({clv_stats['positive_clv_rate']}%)\n"
                f"{'✅ Modelo superando al mercado!' if clv_stats['avg_clv'] > 1 else '⚠️ Revisar estrategia'}"
            )
    dates_to_check = [(now + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(5)]
    all_fixtures = {}
    for date_str in dates_to_check:
        for league in LEAGUES_TO_SCAN:
            all_fixtures.update(get_fixtures_for_date(league, date_str))
    print("[DC] Entrenando modelos Dixon-Coles separados por mercado...")
    dc_params_over = {}
    dc_params_under = {}
    dc_params_btts = {}
    dc_params = {}  # General (backward compatibility)
    
    for league in LEAGUES_TO_SCAN:
        print(f"[DC] Liga {league}: Entrenando modelos...")
        dc_params_over[league] = get_dc_parameters(league, target_market="over")
        time.sleep(0.3)
        dc_params_under[league] = get_dc_parameters(league, target_market="under")
        time.sleep(0.3)
        dc_params_btts[league] = get_dc_parameters(league, target_market="btts")
        time.sleep(0.3)
        dc_params[league] = get_dc_parameters(league, target_market="general")
        
        # Log diferencias entre modelos
        if dc_params_over[league] and dc_params_under[league]:
            rho_over = dc_params_over[league].get("rho", 0)
            rho_under = dc_params_under[league].get("rho", 0)
            print(f"[DC] Liga {league}: rho_over={rho_over:.3f}, rho_under={rho_under:.3f} (Δ={rho_over-rho_under:+.3f})")
        
        time.sleep(0.5)
    
    # ════════════════════════════════════════════════════════════════════════
    # ENTRENAR XGBOOST V4.1 (point-in-time + multi-temporada + BTTS + adaptativo)
    # ════════════════════════════════════════════════════════════════════════
    if ENABLE_XGBOOST and xgb_predictor:
        print("[XGB-V4.1] Preparando datos históricos (multi-temporada)...")
        
        # Recopilar partidos de últimas 2 temporadas
        historical_fixtures = []
        seasons_to_fetch = [2024, 2025]  # 2 temporadas para evitar drift
        
        for league in LEAGUES_TO_SCAN[:5]:  # Top 5 ligas
            for season in seasons_to_fetch:
                try:
                    print(f"[XGB-V4.1] Descargando liga {league}, temporada {season}...")
                    url = f"https://v3.football.api-sports.io/fixtures?league={league}&season={season}&status=FT"
                    data = api_get(url)
                    fixtures = data.get("response", [])
                    
                    for fixture in fixtures[:200]:  # Max 200 por liga/temporada
                        try:
                            goals = fixture.get('goals', {})
                            home_goals = goals.get('home')
                            away_goals = goals.get('away')
                            
                            if home_goals is None or away_goals is None:
                                continue
                            
                            teams = fixture.get('teams', {})
                            home_team = teams.get('home', {})
                            away_team = teams.get('away', {})
                            fixture_data = fixture.get('fixture', {})
                            
                            historical_fixtures.append({
                                'home_team_id': home_team.get('id'),
                                'away_team_id': away_team.get('id'),
                                'home_goals': home_goals,
                                'away_goals': away_goals,
                                'date': fixture_data.get('date', f'{season}-01-01'),
                                'league_id': league,
                                'season': season
                            })
                        except:
                            continue
                    
                    time.sleep(0.5)  # Rate limiting
                except Exception as e:
                    print(f"[XGB-V4.1] Error obteniendo liga {league} temporada {season}: {e}")
                    continue
        
        print(f"[XGB-V4.1] Total partidos recopilados: {len(historical_fixtures)} (2 temporadas)")
        
        # Entrenar modelo match-level con point-in-time
        if len(historical_fixtures) >= 100:
            xgb_predictor.train_match_level(historical_fixtures)
        else:
            print(f"[XGB-V4.1] ⚠️ Muy pocos partidos ({len(historical_fixtures)}), XGBoost desactivado")
    # ════════════════════════════════════════════════════════════════════════
    
    print("[CONFIDENCE] Recalculando confidence_score para filas existentes con N/A...")
    recalculate_confidence_for_existing(existing_rows, dc_params)
    league_names = {
        39: "Premier League", 40: "Championship", 140: "La Liga", 141: "Segunda División",
        135: "Serie A", 136: "Serie B", 78: "Bundesliga", 79: "2. Bundesliga",
        61: "Ligue 1", 62: "Ligue 2", 88: "Eredivisie", 179: "Scottish Premiership", 94: "Primeira Liga",
        144: "Jupiler Pro League", 207: "Super League"
    }
    # Diccionario para guardar la mejor alerta por partido (fixture_id)
    best_alerts = {}  # fixture_id -> (confidence, edge, message)

    for date_str in dates_to_check:
        for league in LEAGUES_TO_SCAN:
            league_name = league_names.get(league, f"Liga {league}")
            params = LEAGUE_PARAMS.get(league, DEFAULT_PARAMS)
            url = f"https://v3.football.api-sports.io/odds?league={league}&season={SEASON}&date={date_str}"
            data = api_get(url)
            games = data.get("response", [])
            print(f"[SCAN] Liga {league_name} ({league}): {len(games)} partidos con odds disponibles en {date_str}")
            dc_param = dc_params[league]
            use_dc = dc_param is not None and dc_param.get("n_matches", 0) >= params["min_matches"]
            for g in games:
                try:
                    fixture_id_raw = g.get("fixture", {}).get("id")
                    if not fixture_id_raw:
                        print(f"[SCAN] ⚠️ Fixture sin ID en odds response, saltando")
                        continue
                    
                    # Convertir a string para búsqueda en diccionario
                    fixture_id = str(fixture_id_raw)
                    
                    # Verificar que el fixture existe en all_fixtures
                    if fixture_id not in all_fixtures:
                        print(f"[SCAN] ⚠️ Fixture {fixture_id} no encontrado en all_fixtures, saltando")
                        continue
                    fix_info = all_fixtures[fixture_id]
                    home_team = fix_info["home"]
                    away_team = fix_info["away"]
                    league_name_api = fix_info["league_name"]
                    dt = parse_date_flexible(fix_info["date"])
                    if dt is None or dt <= now + timedelta(minutes=15):
                        print(f"[SCAN] Saltando partido ya empezado/cercano: {home_team['name']} vs {away_team['name']} - {dt}")
                        continue
                    print(f"[SCAN] Analizando partido: {home_team['name']} vs {away_team['name']} - Fixture ID: {fixture_id} - Fecha: {dt}")
                    current_odds_temp = get_current_odd(fixture_id)
                    
                    # FILTRO CRÍTICO TEMPRANO: Verificar si hay al menos 1 odd válida en rango
                    # Si TODAS las odds están fuera de rango, saltar partido completo
                    valid_odds_count = 0
                    for key in ["over25", "under25", "btts_yes", "btts_no"]:
                        odd_value, _ = current_odds_temp.get(key, (None, None))
                        if odd_value and (MIN_ODD <= odd_value <= MAX_ODD):
                            valid_odds_count += 1
                    
                    if valid_odds_count == 0:
                        print(f"[SCAN] ⏭️ Partido descartado: TODAS las odds fuera de rango [{MIN_ODD}-{MAX_ODD}]")
                        continue
                    
                    home_stats = get_weighted_team_stats(home_team["id"], league)
                    away_stats = get_weighted_team_stats(away_team["id"], league)
                    home_form = get_team_form_indicator(home_team["id"], league)
                    away_form = get_team_form_indicator(away_team["id"], league)
                    form_diff = home_form - away_form
                    h2h = get_h2h_stats(home_team["id"], away_team["id"], league)
                    h2h_available = h2h is not None
                    attack_home = home_stats["gf_home"]
                    defence_away = away_stats["ga_away"]
                    attack_away = away_stats["gf_away"]
                    defence_home = home_stats["ga_home"]
                    
                    # MEJORA #2: Ajuste asimétrico por forma (penaliza más la mala forma)
                    form_adjustment_h_simple = calculate_form_adjustment(home_form)
                    form_adjustment_a_simple = calculate_form_adjustment(away_form)
                    
                    lambda_h_simple = attack_home * defence_away * (1 + params["home_adv"]) * form_adjustment_h_simple
                    lambda_a_simple = attack_away * defence_home * form_adjustment_a_simple
                    
                    # MEJORA #1: H2H con peso adaptativo según calidad
                    if h2h_available:
                        h2h_weight = 0.05 + (h2h["quality"] * 0.15)  # Entre 0.05 (2 partidos) y 0.20 (5+ partidos)
                        lambda_h_simple = lambda_h_simple * (1 - h2h_weight) + h2h["home_goals_avg"] * h2h_weight
                        lambda_a_simple = lambda_a_simple * (1 - h2h_weight) + h2h["away_goals_avg"] * h2h_weight
                    lambda_h_simple = np.clip(lambda_h_simple, 0.5, 4.0)
                    lambda_a_simple = np.clip(lambda_a_simple, 0.5, 4.0)
                    rho_simple = params["rho_prior"]
                    probs_simple = match_probabilities_enhanced(lambda_h_simple, lambda_a_simple, rho_simple)
                    model_name = "Ponderado-Mejorado"
                    dc_quality_for_conf = 0.6
                    
                    # NUEVO: Calcular probabilidades separadas por mercado usando modelos específicos
                    probs_raw_dict = {}
                    lambda_h_ensemble = lambda_h_simple
                    lambda_a_ensemble = lambda_a_simple
                    
                    # Verificar si hay DC disponible (verificamos con modelo general)
                    if use_dc and home_team["id"] in dc_param["team_to_idx"] and away_team["id"] in dc_param["team_to_idx"]:
                        dc_quality_raw = min(dc_param["n_matches"] / 80.0, 1.0)
                        dc_quality_for_conf = dc_quality_raw
                        model_name = "Ensemble-DC-XGB-V4.1" if (ENABLE_XGBOOST and xgb_predictor and xgb_predictor.trained) else "Ensemble-DC-Split"
                        
                        # CORRECCIÓN: Calcular lambda_ensemble con modelo GENERAL (coherencia física)
                        # Lambda ensemble representa los goles esperados del partido globalmente
                        # No debe depender del mercado específico que estamos evaluando
                        idx_h_general = dc_param["team_to_idx"][home_team["id"]]
                        idx_a_general = dc_param["team_to_idx"][away_team["id"]]
                        
                        form_adjustment_h_general = calculate_form_adjustment(home_form)
                        form_adjustment_a_general = calculate_form_adjustment(away_form)
                        
                        lambda_h_dc_general = np.exp(dc_param["attack"][idx_h_general] + dc_param["defence"][idx_a_general] + dc_param["home_adv"]) * form_adjustment_h_general
                        lambda_a_dc_general = np.exp(dc_param["attack"][idx_a_general] + dc_param["defence"][idx_h_general]) * form_adjustment_a_general
                        
                        if h2h_available:
                            h2h_weight = 0.05 + (h2h["quality"] * 0.15)
                            lambda_h_dc_general = lambda_h_dc_general * (1 - h2h_weight) + h2h["home_goals_avg"] * h2h_weight
                            lambda_a_dc_general = lambda_a_dc_general * (1 - h2h_weight) + h2h["away_goals_avg"] * h2h_weight
                        
                        # Ensemble global (usado para filtros)
                        weight_dc_base = min(0.80, 0.70 + 0.25 * dc_quality_raw)
                        weight_simple = 1.0 - weight_dc_base
                        lambda_h_ensemble = weight_dc_base * lambda_h_dc_general + weight_simple * lambda_h_simple
                        lambda_a_ensemble = weight_dc_base * lambda_a_dc_general + weight_simple * lambda_a_simple
                        
                        # Calcular para cada mercado con su modelo específico
                        for key in ["over25", "under25", "btts_yes", "btts_no"]:
                            # Seleccionar modelo DC específico del mercado
                            if key == "over25":
                                dc_param_market = dc_params_over[league]
                            elif key == "under25":
                                dc_param_market = dc_params_under[league]
                            else:  # btts_yes, btts_no
                                dc_param_market = dc_params_btts[league]
                            
                            # Si el modelo específico no está disponible, usar general
                            if not dc_param_market or home_team["id"] not in dc_param_market.get("team_to_idx", {}):
                                probs_raw_dict[key] = probs_simple[key]
                                continue
                            
                            idx_h = dc_param_market["team_to_idx"][home_team["id"]]
                            idx_a = dc_param_market["team_to_idx"][away_team["id"]]
                            
                            # MEJORA #2: Ajuste asimétrico por forma también en Dixon-Coles
                            form_adjustment_h_dc = calculate_form_adjustment(home_form)
                            form_adjustment_a_dc = calculate_form_adjustment(away_form)
                            
                            # CORRECCIÓN: Ahora home_adv y attack/defence son iguales entre modelos
                            # Solo varía rho (el parámetro más importante para Over/Under)
                            lambda_h_dc = np.exp(dc_param_market["attack"][idx_h] + dc_param_market["defence"][idx_a] + dc_param_market["home_adv"]) * form_adjustment_h_dc
                            lambda_a_dc = np.exp(dc_param_market["attack"][idx_a] + dc_param_market["defence"][idx_h]) * form_adjustment_a_dc
                            
                            # MEJORA #1: H2H con peso adaptativo en Dixon-Coles
                            if h2h_available:
                                h2h_weight = 0.05 + (h2h["quality"] * 0.15)
                                lambda_h_dc = lambda_h_dc * (1 - h2h_weight) + h2h["home_goals_avg"] * h2h_weight
                                lambda_a_dc = lambda_a_dc * (1 - h2h_weight) + h2h["away_goals_avg"] * h2h_weight
                            
                            # El único parámetro que varía por mercado es rho
                            rho_dc = dc_param_market["rho"]
                            probs_dc = match_probabilities_enhanced(lambda_h_dc, lambda_a_dc, rho_dc)
                            
                            # Calcular lambda provisional para peso dinámico
                            lambda_h_provisional = weight_dc_base * lambda_h_dc + (1 - weight_dc_base) * lambda_h_simple
                            lambda_a_provisional = weight_dc_base * lambda_a_dc + (1 - weight_dc_base) * lambda_a_simple
                            total_lambda_provisional = lambda_h_provisional + lambda_a_provisional
                            
                            # MEJORA #4: Peso dinámico según características del partido
                            w_dc = calculate_market_weight(key, dc_quality_raw, total_lambda_provisional)
                            probs_raw_dict[key] = w_dc * probs_dc[key] + (1 - w_dc) * probs_simple[key]
                    
                    else:
                        # Sin Dixon-Coles, usar modelo simple para todos
                        probs_raw_dict = {k: probs_simple[k] for k in ["over25", "under25", "btts_yes", "btts_no"]}
                    
                    # ═══════════════════════════════════════════════════════════════════
                    # COMBINAR CON XGBOOST V4 (peso adaptativo + BTTS)
                    # ═══════════════════════════════════════════════════════════════════
                    if ENABLE_XGBOOST and xgb_predictor and xgb_predictor.trained:
                        try:
                            # Obtener stats de equipos (ya las tiene el bot)
                            home_stats = get_weighted_team_stats(home_team["id"], league)
                            away_stats = get_weighted_team_stats(away_team["id"], league)
                            
                            # Predecir con XGBoost (ahora incluye BTTS)
                            xgb_probs = xgb_predictor.predict_probs(home_stats, away_stats)
                            
                            if xgb_probs:
                                # Obtener peso adaptativo actual
                                current_weight = xgb_predictor.get_current_weight()
                                
                                # Guardar predicciones DC puras para tracking (antes de ensemble)
                                dc_over_pure = probs_raw_dict.get("over25", 50)
                                dc_under_pure = probs_raw_dict.get("under25", 50)
                                dc_btts_yes_pure = probs_raw_dict.get("btts_yes", 50)
                                dc_btts_no_pure = probs_raw_dict.get("btts_no", 50)
                                
                                xgb_over = xgb_probs["over25"]
                                xgb_under = xgb_probs["under25"]
                                xgb_btts_yes = xgb_probs.get("btts_yes", dc_btts_yes_pure)
                                xgb_btts_no = xgb_probs.get("btts_no", dc_btts_no_pure)
                                
                                # Ensemble ponderado con peso adaptativo
                                probs_raw_dict["over25"] = (1 - current_weight) * dc_over_pure + current_weight * xgb_over
                                probs_raw_dict["under25"] = (1 - current_weight) * dc_under_pure + current_weight * xgb_under
                                probs_raw_dict["btts_yes"] = (1 - current_weight) * dc_btts_yes_pure + current_weight * xgb_btts_yes
                                probs_raw_dict["btts_no"] = (1 - current_weight) * dc_btts_no_pure + current_weight * xgb_btts_no
                                
                                # ═══════════════════════════════════════════════════════════════
                                # FILTRO DE CONSENSO DC vs XGBoost (V4.1 Feature)
                                # Solo apostar cuando ambos modelos estén de acuerdo
                                # Impacto estimado: +2.0 puntos ROI
                                # ═══════════════════════════════════════════════════════════════
                                if ENABLE_CONSENSUS_FILTER:
                                    # Calcular desacuerdos por mercado
                                    disagreement_over = abs(dc_over_pure - xgb_over) / 100.0
                                    disagreement_under = abs(dc_under_pure - xgb_under) / 100.0
                                    disagreement_btts_yes = abs(dc_btts_yes_pure - xgb_btts_yes) / 100.0
                                    disagreement_btts_no = abs(dc_btts_no_pure - xgb_btts_no) / 100.0
                                    
                                    max_disagreement = max(disagreement_over, disagreement_under, 
                                                          disagreement_btts_yes, disagreement_btts_no)
                                    
                                    if max_disagreement > CONSENSUS_THRESHOLD:
                                        # Identificar qué mercado tiene desacuerdo
                                        disagreements = {
                                            'Over 2.5': disagreement_over,
                                            'Under 2.5': disagreement_under,
                                            'BTTS Yes': disagreement_btts_yes,
                                            'BTTS No': disagreement_btts_no
                                        }
                                        worst_market = max(disagreements, key=disagreements.get)
                                        worst_diff = disagreements[worst_market]
                                        
                                        print(f"[CONSENSUS] ⚠️ SKIP partido: {home_team} vs {away_team}")
                                        print(f"[CONSENSUS] Desacuerdo en {worst_market}: {worst_diff*100:.1f}% > {CONSENSUS_THRESHOLD*100:.0f}%")
                                        print(f"[CONSENSUS] DC vs XGB - Over: {dc_over_pure:.1f}% vs {xgb_over:.1f}%, Under: {dc_under_pure:.1f}% vs {xgb_under:.1f}%")
                                        
                                        # Skip este partido completamente
                                        continue
                                    else:
                                        print(f"[CONSENSUS] ✅ Consenso OK: max desacuerdo {max_disagreement*100:.1f}% ≤ {CONSENSUS_THRESHOLD*100:.0f}%")
                                # ═══════════════════════════════════════════════════════════════
                                
                                print(f"[XGB] Weight={current_weight:.2f} | Over: DC={dc_over_pure:.1f}% XGB={xgb_over:.1f}% → {probs_raw_dict['over25']:.1f}%")
                                print(f"[XGB] BTTS: DC={dc_btts_yes_pure:.1f}% XGB={xgb_btts_yes:.1f}% → {probs_raw_dict['btts_yes']:.1f}%")
                            else:
                                # V4.2.1: XGBoost returned None → Fallback to DC
                                xgb_predictor._log_fallback(
                                    "XGBoost predict_probs devolvió None",
                                    f"{home_team} vs {away_team}"
                                )
                        except Exception as e:
                            # V4.2.1: Enhanced error logging
                            xgb_predictor._log_fallback(
                                f"Error en ensemble: {str(e)[:100]}",
                                f"{home_team} vs {away_team}"
                            )
                            print(f"[XGB] Error en ensemble: {e}, usando solo DC")
                    # ═══════════════════════════════════════════════════════════════════
                    
                    total_lambda = lambda_h_ensemble + lambda_a_ensemble
                    if not (1.6 <= total_lambda <= 4.2):
                        print(f"[SCAN] FILTRO λ total fuera de rango ({total_lambda:.2f}) → saltando partido")
                        continue
                    over_under_sum = probs_raw_dict["over25"] + probs_raw_dict["under25"]
                    if not (95 <= over_under_sum <= 105):
                        print(f"[SCAN] FILTRO sanity check fallido (sum={over_under_sum:.1f}%) → saltando partido")
                        continue
                    alerts_this_match = 0
                    for key in ["over25", "under25", "btts_yes", "btts_no"]:
                        best_odd, book_name = current_odds_temp.get(key, (None, None))
                        if not best_odd:
                            print(f"[SCAN] Mercado {key.upper()}: No odd encontrada")
                            continue
                        
                        # FILTRO CRÍTICO: Descartar inmediatamente odds fuera de rango
                        # No vale la pena ni calcular edge si la odd está fuera del rango aceptable
                        if not (MIN_ODD <= best_odd <= MAX_ODD):
                            print(f"[SCAN] Mercado {key.upper()}: Odd {best_odd:.2f} fuera de rango [{MIN_ODD}-{MAX_ODD}] → DESCARTADO")
                            continue
                        
                        selection = {
                            "over25": "Over 2.5",
                            "under25": "Under 2.5",
                            "btts_yes": "BTTS Yes",
                            "btts_no": "BTTS No"
                        }[key]
                        model_prob_raw = probs_raw_dict[key]
                        market_prob = 100 / best_odd
                        
                        # MEJORA #1: Usar calibración específica del mercado
                        alpha, beta = calibrations.get(key, (0.92, 0.08))
                        model_prob_calibrated = calibrate_probability(model_prob_raw, market_prob, alpha=alpha, beta=beta)
                        
                        edge = model_prob_calibrated - market_prob
                        
                        # MEJORA #5: Usar min_edge diferenciado por mercado
                        min_edge_pct = min_edge_required(best_odd, market_key=key)
                        
                        confidence = calculate_confidence_score(model_prob_calibrated, market_prob, edge, dc_quality_for_conf, h2h_available, form_diff)
                        print(f"[SCAN] {selection}: Odd {book_name} {best_odd:.2f} | Modelo raw {model_prob_raw:.1f}% | Calibrated {model_prob_calibrated:.1f}% (α={alpha:.2f}) | Edge {edge:.1f}% (min {min_edge_pct}%) | Confidence {confidence}%")
                        if edge >= min_edge_pct and confidence >= 60:
                            print(f"[SCAN] → ALERTA SÍ añadida para {selection}")
                            alerts_this_match += 1
                            fair_odd = round(100 / model_prob_calibrated, 2)
                            stake = kelly_fractional(model_prob_calibrated, best_odd)
                            message = f"""⚡ VALUE BET ({model_name})
🏆 {league_name_api}
⚽ {home_team['name']} vs {away_team['name']}
📅 {dt.strftime('%d/%m %H:%M')}
🎯 {selection}
🏦 {book_name}: {best_odd:.2f} ({round(market_prob,1)}%)
📊 Modelo: {fair_odd:.2f} ({model_prob_calibrated:.1f}%)
🔥 Edge: +{edge:.1f}%
🎖️ Confianza: {confidence}%
📈 Kelly: {stake}%"""
                            # Guardar fila para CSV (todas las bets válidas)
                            unique_str = f"{fixture_id}{ 'Over/Under 2.5' if key in ['over25', 'under25'] else 'BTTS' }{selection.replace(' ', '')}"
                            unique_id = hashlib.md5(unique_str.encode()).hexdigest()
                            row_data = {
                                "execution_date": execution_date,
                                "match_date": dt.strftime('%Y-%m-%d %H:%M'),
                                "league": league_name_api,
                                "home_team": home_team['name'],
                                "away_team": away_team['name'],
                                "market": 'Over/Under 2.5' if key in ['over25', 'under25'] else 'BTTS',
                                "selection": selection,
                                "betfair_odd": best_odd,
                                "model_prob_raw": round(model_prob_raw, 2),
                                "model_prob_calibrated": round(model_prob_calibrated, 2),
                                "fair_odd": fair_odd,
                                "edge": round(edge, 2),
                                "kelly": stake,
                                "model_used": model_name,
                                "confidence_score": confidence,
                                "unique_id": unique_id,
                                "fixture_id": fixture_id,
                                "match_dt": dt
                            }
                            rows_to_save_or_update.append(row_data)

                            # Guardar la mejor alerta para Telegram (solo una por partido)
                            current_score = (confidence, edge)
                            if fixture_id not in best_alerts or current_score > best_alerts[fixture_id][:2]:
                                best_alerts[fixture_id] = (confidence, edge, message)
                        else:
                            motivos = []
                            if edge < min_edge_pct:
                                motivos.append(f"edge bajo ({edge:.1f}% < {min_edge_pct}%)")
                            if confidence < 60:
                                motivos.append(f"confidence baja ({confidence}% < 60%)")
                            print(f"[SCAN] → ALERTA NO para {selection}: {', '.join(motivos) if motivos else 'No motivos específicos'}")
                    print(f"[SCAN] Partido completo: {alerts_this_match} alertas generadas\n")
                    time.sleep(0.8)
                except Exception as e:
                    print(f"Error en partido: {e}")
                    continue
    print("[RE-EVAL] Revisando picks existentes pendientes...")
    updated_cuotas = 0
    for row in existing_rows[:]:
        print(f"[RE-EVAL] Analizando fila: {row['home_team']} vs {row['away_team']} - Mercado: {row['market']} - Selección: {row['selection']} - Fecha: {row['match_date']} - Fixture ID: {row.get('fixture_id', 'N/A')} - Confidence actual: {row.get('confidence_score', 'N/A')} - Edge: {row.get('edge', 'N/A')} - Ultima cuota: {row.get('ultima_cuota', 'N/A')}")
        if row.get("bet_result", "").strip():
            print(f"[RE-EVAL] Saltando: Partido ya resuelto ({row['bet_result']})")
            continue
        match_dt = parse_date_flexible(row["match_date"])
        if match_dt is None:
            print(f"[RE-EVAL] Saltando: Error en formato de fecha ({row['match_date']})")
            continue
        if match_dt <= now + timedelta(minutes=15):
            print(f"[RE-EVAL] Saltando: Partido ya empezado o cercano (fecha {match_dt})")
            continue
        fixture_id = row.get("fixture_id", "").strip()
        if not fixture_id:
            print(f"[RE-EVAL] Saltando: Sin fixture_id")
            continue
        # ✅ VALIDACIÓN ADICIONAL: Convertir a int si es necesario
        try:
            fixture_id = int(fixture_id) if fixture_id.isdigit() else fixture_id
        except (ValueError, TypeError):
            print(f"[RE-EVAL] ⚠️ fixture_id inválido: {fixture_id}, saltando")
            continue
        # FIX: all_fixtures usa strings como keys, convertir fixture_id a string para comparar
        if str(fixture_id) not in all_fixtures:
            print(f"[RE-EVAL] Saltando: Fixture {fixture_id} no en próximos 5 días")
            continue
        # Obtener todas las odds del fixture (1 sola llamada API)
        all_odds = get_current_odd(fixture_id)

        # Mapear la selección al key correcto
        selection_map = {
        "Over 2.5": "over25",
        "Under 2.5": "under25",
        "BTTS Yes": "btts_yes",
        "BTTS No": "btts_no"
        }
        key = selection_map.get(row["selection"])
        current_odd, book_name = all_odds.get(key, (None, None)) if key else (None, None)
        found_in_api = current_odd is not None
        if current_odd is None:
            ultima_str = row.get("ultima_cuota", "").strip()
            if ultima_str and ultima_str != "0" and ultima_str != "N/A":
                current_odd = float(ultima_str)
                book_name = "Ejecución anterior (casa no registrada)"
                print(f"[RE-EVAL] Fallback: usando ultima_cuota {current_odd:.2f} de ejecución anterior. Partido: {row['home_team']} vs {row['away_team']} - {row['selection']}")
            else:
                print(f"[RE-EVAL] No hay cuota actual ni ultima_cuota → saltando alerta")
                continue
        old_odd = float(row.get("ultima_cuota", "0") or 0)
        if abs(old_odd - current_odd) >= 0.01:
            print(f"[RE-EVAL] Cuota actualizada: {old_odd:.2f} → {current_odd:.2f} (de {book_name})")
            updated_cuotas += 1
        row["ultima_cuota"] = f"{current_odd:.2f}"
        row["ultima_fecha_hora"] = execution_date
        row["modified"] = True
        model_prob_cal = float(row.get("model_prob_calibrated", 0))
        if model_prob_cal == 0:
            print(f"[RE-EVAL] No model_prob_calibrated → saltando alerta")
            continue
        market_prob = 100 / current_odd
        edge = model_prob_cal - market_prob
        
        # MEJORA #5: Usar min_edge diferenciado por mercado
        selection_to_key = {
            "Over 2.5": "over25",
            "Under 2.5": "under25",
            "BTTS Yes": "btts_yes",
            "BTTS No": "btts_no"
        }
        market_key = selection_to_key.get(row.get("selection"))
        min_edge_pct = min_edge_required(current_odd, market_key=market_key)
        
        confidence = float(row.get("confidence_score", 0) or 0)
        print(f"[RE-EVAL] Cuota {'API (' + book_name + ')' if found_in_api else 'fallback (' + book_name + ')'} : {current_odd:.2f} | Edge: {edge:.1f}% (min {min_edge_pct}%) | Confidence: {confidence}%")
        if edge >= min_edge_pct and confidence >= 60:
            prefix = "⚡ VALUE BET REPETIDA" if found_in_api else "🔄 VALUE BET REPETIDA (fallback)"
            message = f"""{prefix}
🏆 {row['league']}
⚽ {row['home_team']} vs {row['away_team']}
📅 {match_dt.strftime('%d/%m %H:%M')}
🎯 {row['selection']}
🏦 {book_name}: {current_odd:.2f} ({market_prob:.1f}%)
📊 Modelo: {row['fair_odd']} ({model_prob_cal:.1f}%)
🔥 Edge: +{edge:.1f}%
🎖️ Confianza: {confidence}%
📈 Kelly: {row['kelly']}%"""
            # Guardar la mejor alerta para Telegram (solo una por partido)
            current_score = (confidence, edge)
            if fixture_id not in best_alerts or current_score > best_alerts[fixture_id][:2]:
                best_alerts[fixture_id] = (confidence, edge, message)
        else:
            print(f"[RE-EVAL] NO enviando alerta: edge {edge:.1f}% < {min_edge_pct}% o confidence {confidence}% < 60%")
    if updated_cuotas > 0:
        print(f"[RE-EVAL] {updated_cuotas} cuotas actualizadas en picks existentes.")
    save_or_update_history_csv(rows_to_save_or_update, existing_rows, now)
    git_commit_and_push()
    if best_alerts:
        # Construir candidates a partir de la mejor alerta por partido
        candidates = [(conf, edge, msg) for conf, edge, msg in best_alerts.values()]
        candidates.sort(reverse=True, key=lambda x: (x[0], x[1]))
        top_n = min(TOP_ALERTS, len(candidates))
        send_telegram(f"📊 {len(candidates)} VALUE BETS – Top {top_n}\n")
        for i, (conf, edge, msg) in enumerate(candidates[:top_n], 1):
            send_telegram(f"#{i} | Conf {conf}% | Edge +{edge:.1f}%\n\n" + msg)
            time.sleep(2)
    else:
        send_telegram(f"ℹ️ No hay value bets con filtros optimizados.")
    if os.path.exists(HISTORY_CSV):
        try:
            total_rows = 0
            if os.path.getsize(HISTORY_CSV) > 0:
                with open(HISTORY_CSV, encoding='utf-8') as f:
                    total_rows = sum(1 for _ in f) - 1
            with open(HISTORY_CSV, "rb") as f:
                files = {"document": ("over_under_value_bets.csv", f, "text/csv")}
                caption = f"📊 Histórico Value Bets\nActualizado: {execution_date} UTC\nTotal: {total_rows}{stats_caption_extra}"
                requests.post(
                    f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendDocument",
                    data={"chat_id": TELEGRAM_CHAT_ID, "caption": caption, "parse_mode": "Markdown"},
                    files=files,
                    timeout=60
                )
            print("[TELEGRAM] CSV enviado.")
            
            # MEJORA #1: Enviar resumen de RESULTADOS DE AYER
            time.sleep(2)  # Pequeña pausa entre mensajes
            send_yesterday_results(existing_rows)
            
            # MEJORA #2: Enviar resumen de apuestas abiertas para HOY
            time.sleep(2)  # Pequeña pausa entre mensajes
            send_todays_open_bets(existing_rows, execution_date)
            
            # MEJORA V4.1 #3: Enviar resumen automático de performance
            time.sleep(2)
            send_performance_summary(existing_rows)
            
        except Exception as e:
            print(f"Error enviando CSV: {e}")

def send_performance_summary(existing_rows):
    """
    MEJORA V4.1: Resumen automático de performance
    Envía métricas diarias por Telegram
    """
    try:
        from datetime import datetime, timedelta
        
        print("[SUMMARY] Calculando resumen de performance...")
        
        # Filtrar picks resueltos
        resolved = [r for r in existing_rows if r.get('result') in ['Won', 'Lost']]
        
        if len(resolved) < 5:
            print("[SUMMARY] Muy pocos picks resueltos (<5), saltando resumen")
            return
        
        # Calcular métricas últimos 30 días
        now = datetime.now()
        thirty_days_ago = now - timedelta(days=30)
        sixty_days_ago = now - timedelta(days=60)
        
        recent_30 = []
        recent_60 = []
        
        for row in resolved:
            try:
                bet_date = datetime.strptime(row.get('date', '2025-01-01'), '%Y-%m-%d')
                if bet_date >= thirty_days_ago:
                    recent_30.append(row)
                if bet_date >= sixty_days_ago:
                    recent_60.append(row)
            except:
                continue
        
        # Si no hay datos recientes, usar todos
        if not recent_30:
            recent_30 = resolved[-50:] if len(resolved) > 50 else resolved
        
        # Calcular ROI
        def calculate_roi(picks):
            if not picks:
                return 0, 0, 0
            total_stake = sum([float(row.get('kelly_stake', 1.0)) for row in picks])
            total_profit = sum([float(row.get('profit', 0)) for row in picks])
            wins = sum([1 for row in picks if row.get('result') == 'Won'])
            return (total_profit / total_stake * 100) if total_stake > 0 else 0, wins, len(picks)
        
        roi_30, wins_30, total_30 = calculate_roi(recent_30)
        win_rate_30 = (wins_30 / total_30 * 100) if total_30 > 0 else 0
        
        # ROI por mercado
        over_picks = [r for r in recent_30 if 'Over' in r.get('pick', '')]
        under_picks = [r for r in recent_30 if 'Under' in r.get('pick', '')]
        btts_picks = [r for r in recent_30 if 'BTTS' in r.get('pick', '')]
        
        roi_over, _, total_over = calculate_roi(over_picks)
        roi_under, _, total_under = calculate_roi(under_picks)
        roi_btts, _, total_btts = calculate_roi(btts_picks)
        
        # CLV promedio
        clv_values = [float(row.get('clv', 0)) for row in recent_30 if row.get('clv')]
        clv_avg = np.mean(clv_values) if clv_values else 0
        
        # Peso XGB actual
        xgb_weight = xgb_predictor.get_current_weight() if (ENABLE_XGBOOST and xgb_predictor) else 0
        
        # Picks hoy
        today_str = now.strftime('%Y-%m-%d')
        picks_today = [r for r in existing_rows if r.get('date') == today_str]
        
        # Formatear mensaje
        mensaje = f"""📊 **RESUMEN DIARIO** - {now.strftime('%d %b %Y')}
════════════════════════════════

📈 **PERFORMANCE** (últimos 30 días)
────────────────────────────────
ROI Total:        **{roi_30:+.1f}%** ({total_30} picks)
ROI Over 2.5:     {roi_over:+.1f}% ({total_over} picks)
ROI Under 2.5:    {roi_under:+.1f}% ({total_under} picks)
ROI BTTS:         {roi_btts:+.1f}% ({total_btts} picks)

Win Rate:         **{win_rate_30:.1f}%**
CLV Promedio:     **{clv_avg:+.1f}%**

🤖 **MODELOS**
────────────────────────────────"""

        # Añadir info XGBoost si está activo
        if ENABLE_XGBOOST and xgb_predictor and xgb_predictor.trained:
            mensaje += f"""
Peso XGB actual:  **{xgb_weight:.2f}**
Modelo:           V4.1 (point-in-time + BTTS)"""
            
            # Añadir info filtro consenso
            if ENABLE_CONSENSUS_FILTER:
                mensaje += f"""
Filtro consenso:  **✅ Activo** (threshold {CONSENSUS_THRESHOLD*100:.0f}%)"""
            
            # V4.2.1: Añadir resumen de fallbacks si hay
            if xgb_predictor.fallback_count > 0:
                mensaje += f"""
Fallbacks hoy:    **⚠️ {xgb_predictor.fallback_count}** (usando DC)"""
        else:
            mensaje += f"""
Modelo:           V3 (Dixon-Coles separado)"""

        mensaje += f"""

⚡ **HOY**
────────────────────────────────
Picks enviados:   {len(picks_today)}

════════════════════════════════
"""

        # Enviar por Telegram
        send_telegram(mensaje)
        print("[SUMMARY] ✅ Resumen de performance enviado")
        
    except Exception as e:
        print(f"[SUMMARY] Error generando resumen: {e}")

if __name__ == "__main__":
    run_bot()
