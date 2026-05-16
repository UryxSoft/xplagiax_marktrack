from flask import Blueprint, jsonify, request, render_template
from flask_login import current_user, login_required
import requests
from models.models import AnalysisLimit, UserAnalysisUsage, StoragePlan

x_analysiscounter = Blueprint('x_analysiscounter', __name__)

@x_analysiscounter.route('/api/analysis/validate-and-analyze', methods=['POST'])
def validate_and_analyze():
    """
    Valida el límite de análisis y llama al endpoint de análisis batch.
    Este endpoint actúa como middleware/proxy.
    """
    try:
        # 1. Validar que el usuario puede realizar análisis
        if not current_user.can_perform_analysis():
            stats = current_user.get_analysis_stats()
            return jsonify({
                'success': False,
                'error': 'Daily analysis limit reached',
                'stats': stats,
                'limit_reached': True,
                'reset_at': stats.get('reset_at'),  # Incluir cuándo se resetea
                'limit_reached_at': stats.get('limit_reached_at')  # Cuándo alcanzó el límite
            }), 403
        
        # 2. Obtener los datos del request original
        data = request.get_json()
        
        if not data or not data.get('texts'):
            return jsonify({
                'success': False,
                'error': 'No texts provided'
            }), 400
        
        # 3. Hacer una llamada interna al endpoint de análisis
        response = requests.post(
            'https://xplagiax.ca/x_aitestpro/api/analyze-batch', #'http://127.0.0.1:5000/x_aitestpro/api/analyze-batch',
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=300
        )
        
        if response.status_code == 200:
            result_data = response.json()
            
            # 4. Incrementar contador SOLO si el análisis fue exitoso
            current_user.increment_analysis_count()
            
            # 5. Obtener stats actualizados
            stats = current_user.get_analysis_stats()

            return jsonify({
                'success': True,
                'result': result_data,
                'stats': stats
            }), 200   
        else:
            return jsonify({
                'success': False,
                'error': 'Analysis service failed',
                'details': response.text
            }), response.status_code
                
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Validation failed: {str(e)}'
        }), 500

@x_analysiscounter.route('/api/analysis/stats', methods=['GET'])
@login_required
def get_analysis_stats():
    """Obtener estadísticas de análisis del usuario actual"""
    try:
        stats = current_user.get_analysis_stats()
        return jsonify({
            'success': True,
            'data': stats
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@x_analysiscounter.route('/api/analysis/perform', methods=['POST'])
@login_required
def perform_analysis():
    """Realizar un análisis (incrementar contador)"""
    try:
        if not current_user.can_perform_analysis():
            stats = current_user.get_analysis_stats()
            return jsonify({
                'success': False,
                'error': 'Daily analysis limit reached',
                'stats': stats
            }), 403
        
        # Incrementar contador
        if current_user.increment_analysis_count():
            stats = current_user.get_analysis_stats()
            return jsonify({
                'success': True,
                'message': 'Analysis performed successfully',
                'stats': stats
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to increment analysis count'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@x_analysiscounter.route('/api/analysis/plans', methods=['GET'])
@login_required
def get_available_plans():
    """Obtener planes disponibles con sus límites"""
    try:
        plans = AnalysisLimit.query.filter_by(is_active=True).all()
        
        current_plan = current_user.user_type or 'Starter'
        
        # Definir jerarquía de planes (de menor a mayor)
        plan_hierarchy = {
            'Starter': 0,
            'Scholar Suite': 1,
            'Individual': 2,
            'Research Essentials': 3
        }
        
        current_plan_level = plan_hierarchy.get(current_plan, 0)
        
        plans_data = []
        for plan in plans:
            # Obtener info del storage plan correspondiente
            storage_plan = StoragePlan.query.filter_by(
                name=plan.plan_name,
                is_active=True
            ).first()
            
            plan_level = plan_hierarchy.get(plan.plan_name, 0)
            
            plans_data.append({
                'name': plan.plan_name,
                'daily_analysis_limit': plan.daily_analysis_limit,
                'description': plan.description,
                'price_monthly': storage_plan.price_monthly_usd if storage_plan else 0,
                'price_annual': storage_plan.price_annual_usd if storage_plan else 0,
                'storage_mb': storage_plan.base_storage_mb if storage_plan else 0,
                'is_upgrade': plan_level > current_plan_level,  # NUEVO: indica si es upgrade
                'is_current_or_lower': plan_level <= current_plan_level  # NUEVO: para deshabilitar
            })
        
        return jsonify({
            'success': True,
            'plans': plans_data,
            'current_plan': current_plan
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@x_analysiscounter.route('/api/analysis/check', methods=['GET'])
@login_required
def check_can_analyze():
    """Verificar rápidamente si el usuario puede analizar"""
    try:
        can_analyze = current_user.can_perform_analysis()
        remaining = current_user.get_remaining_analysis()
        
        return jsonify({
            'success': True,
            'can_analyze': can_analyze,
            'remaining': remaining
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Scheduled job para resetear contadores diarios
def reset_all_daily_analysis():
    """
    Función para resetear todos los contadores diarios.
    Ejecutar con APScheduler o Celery a medianoche UTC.
    """
    from datetime import datetime, timedelta
    from app import db 
    try:
        yesterday = (datetime.utcnow() - timedelta(days=1)).date()
        
        # Resetear todos los registros de ayer
        old_usages = UserAnalysisUsage.query.filter(
            UserAnalysisUsage.usage_date < datetime.utcnow().date()
        ).all()
        
        for usage in old_usages:
            # Opcionalmente archivar datos antiguos antes de eliminar
            db.session.delete(usage)
        
        db.session.commit()
        print(f"✓ Reset {len(old_usages)} old analysis usage records")
        
        return True
    except Exception as e:
        db.session.rollback()
        print(f"✗ Error resetting daily analysis: {e}")
        return False

