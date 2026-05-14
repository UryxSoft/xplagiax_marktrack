import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import current_app

logger = logging.getLogger(__name__)

class MailService:
    """
    Robust mail delivery service with automatic failover between providers.
    Directly uses smtplib to bypass Flask-Mail's global configuration limitations.
    """

    @staticmethod
    def send(message_obj):
        """
        Sends a flask_mail.Message object using a failover strategy.
        Attempts 'noreply' (Ionos) first, then falls back to 'gmail'.
        """
        providers = current_app.config.get('MAIL_PROVIDERS', {})
        # Priority order for delivery
        provider_order = ['noreply', 'gmail']
        
        last_exception = None
        
        for p_key in provider_order:
            config = providers.get(p_key)
            if not config:
                continue
                
            try:
                MailService._send_with_config(message_obj, config)
                logger.info(f"Email successfully sent via provider: {p_key}")
                return True
            except Exception as e:
                last_exception = e
                logger.error(f"Failed to send email via {p_key}: {str(e)}")
                # Continue loop to next provider
                
        # If we reach here, all providers failed
        if last_exception:
            raise last_exception
        return False

    @staticmethod
    def _send_with_config(message, config):
        """Internal helper to execute SMTP delivery for a specific config."""
        server_host = config['MAIL_SERVER']
        server_port = config['MAIL_PORT']
        use_ssl     = config['MAIL_USE_SSL']
        use_tls     = config['MAIL_USE_TLS']
        username    = config['MAIL_USERNAME']
        password    = config['MAIL_PASSWORD']
        
        # 1. Build the MIME message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = message.subject
        # Sender is taken from config to match auth credentials (prevents spoofing rejections)
        msg['From']    = f"{config['MAIL_DEFAULT_SENDER'][0]} <{config['MAIL_DEFAULT_SENDER'][1]}>"
        msg['To']      = ", ".join(message.recipients)

        if message.body:
            msg.attach(MIMEText(message.body, 'plain'))
        if message.html:
            msg.attach(MIMEText(message.html, 'html'))

        # 2. Establish connection
        if use_ssl:
            smtp_conn = smtplib.SMTP_SSL(server_host, server_port, timeout=10)
        else:
            smtp_conn = smtplib.SMTP(server_host, server_port, timeout=10)
            if use_tls:
                smtp_conn.starttls()

        # 3. Authenticate and Send
        try:
            smtp_conn.login(username, password)
            smtp_conn.send_message(msg)
        finally:
            smtp_conn.quit()


# Global instance
mail_service = MailService()
