const form = document.getElementById('forgot-form');
        const successAlert = document.getElementById('success-alert');

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const formData = new FormData(form);

            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': formData.get('csrf_token')
                    },
                    body: JSON.stringify({ email: formData.get('email') })
                });

                const result = await response.json();
                successAlert.textContent = result.message || 'Check your email for the recovery link.';
                successAlert.classList.add('show');
                form.reset();
            } catch (error) {
                successAlert.textContent = 'If the email exists, you will receive a recovery link.';
                successAlert.classList.add('show');
            }
        });
