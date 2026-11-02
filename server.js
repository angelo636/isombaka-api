const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Palavra-passe do Painel Administrativo
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Isombaka25';

// Configuração da Ligação à Base de Dados PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://utilizador:senha@localhost:5432/isombaka_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Configuração do Nodemailer para E-mails
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'angeloenoc40@gmail.com',
        pass: process.env.EMAIL_PASS
    }
});

// 1. ENDPOINT PÚBLICO: Registar Inscrição (suporta /api/inscricao e /api/inscricoes)
const processarInscricao = async (req, res) => {
    const { liga_id, nome_completo, matricula, email, telefone } = req.body;

    if (!nome_completo || !matricula || !email) {
        return res.status(400).json({ sucesso: false, mensagem: 'Por favor, preencha todos os campos obrigatórios.' });
    }

    try {
        const query = `
            INSERT INTO inscricoes (liga_id, nome_completo, matricula, email, telefone, estado_candidatura)
            VALUES ($1, $2, $3, $4, $5, 'Pendente') RETURNING *;
        `;
        const values = [liga_id || 'Geral', nome_completo, matricula, email, telefone || ''];
        const novoRegisto = await pool.query(query, values);

        if (process.env.EMAIL_PASS) {
            try {
                await transporter.sendMail({
                    from: 'Portal ISPOmbaka <angeloenoc40@gmail.com>',
                    to: 'angeloenoc40@gmail.com',
                    subject: `Nova Inscrição - ${(liga_id || 'Geral').toUpperCase()} (${nome_completo})`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; color: #0F1A30;">
                            <h2 style="color: #1E3A8A;">Nova Candidatura Submetida</h2>
                            <p>Foi registada uma nova inscrição no portal das Ligas Académicas do ISPOmbaka:</p>
                            <ul>
                                <li><strong>Liga:</strong> ${(liga_id || 'Geral').toUpperCase()}</li>
                                <li><strong>Nome:</strong> ${nome_completo}</li>
                                <li><strong>Matrícula:</strong> ${matricula}</li>
                                <li><strong>E-mail:</strong> ${email}</li>
                                <li><strong>Telefone:</strong> ${telefone || 'N/A'}</li>
                            </ul>
                        </div>
                    `
                });
            } catch (mailErr) {
                console.warn('Aviso ao enviar e-mail:', mailErr.message);
            }
        }

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Inscrição efetuada com sucesso!',
            dados: novoRegisto.rows[0]
        });

    } catch (err) {
        console.error('Erro ao processar inscrição:', err);
        res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao processar a inscrição.' });
    }
};

app.post('/api/inscricao', processarInscricao);
app.post('/api/inscricoes', processarInscricao);

// 2. ENDPOINT ADMIN: Autenticação e Listagem de Inscrições
app.post('/api/admin/inscricoes', async (req, res) => {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD && password !== 'Isombaka25' && password !== 'Isombaka') {
        return res.status(401).json({ sucesso: false, mensagem: 'Palavra-passe incorreta.' });
    }

    try {
        const result = await pool.query('SELECT * FROM inscricoes ORDER BY id DESC;');
        res.status(200).json({ sucesso: true, dados: result.rows });
    } catch (err) {
        console.error('Erro ao procurar inscrições:', err);
        res.status(500).json({ sucesso: false, mensagem: 'Erro na base de dados.' });
    }
});

// 3. ENDPOINT ADMIN: Alterar Estado da Candidatura
app.patch('/api/admin/inscricao/:id', async (req, res) => {
    const { password, estado } = req.body;
    const { id } = req.params;

    if (password !== ADMIN_PASSWORD && password !== 'Isombaka25' && password !== 'Isombaka') {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    try {
        const result = await pool.query('UPDATE inscricoes SET estado_candidatura = $1 WHERE id = $2 RETURNING *;', [estado, id]);
        if (result.rowCount === 0) return res.status(404).json({ sucesso: false, mensagem: 'Não encontrado.' });
        res.status(200).json({ sucesso: true, dados: result.rows[0] });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor.' });
    }
});

// 4. ENDPOINT ADMIN: Eliminar Inscrição
app.delete('/api/admin/inscricao/:id', async (req, res) => {
    const { password } = req.body;
    const { id } = req.params;

    if (password !== ADMIN_PASSWORD && password !== 'Isombaka25' && password !== 'Isombaka') {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    try {
        const result = await pool.query('DELETE FROM inscricoes WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount === 0) return res.status(404).json({ sucesso: false, mensagem: 'Não encontrado.' });
        res.status(200).json({ sucesso: true, mensagem: 'Eliminado com sucesso.' });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});
